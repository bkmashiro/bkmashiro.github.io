---
title: "nest-faster-crud: Zero-Boilerplate CRUD for NestJS"
date: 2026-03-14
tags: [nestjs, typescript, decorator, crud, backend]
description: "How I built a decorator-driven CRUD framework for NestJS — metadata collection, runtime DTO generation, controller factory, and the design decisions behind it."
readingTime: true
tag:
  - NestJS
  - TypeScript
  - Backend
  - Decorators
  - Framework
outline: [2, 3]
---

Writing CRUD in NestJS is the same boilerplate, every time. Entity class, DTO class, controller with five routes, service with five methods. Multiply that by twenty resources and you have a thousand lines of code that all look identical.

`nest-faster-crud` is my attempt at a more declarative approach: annotate an entity class, register it, and the framework handles the rest.

- GitHub: [bkmashiro/nest-faster-crud](https://github.com/bkmashiro/nest-faster-crud)
- npm: [@faster-crud/nest](https://www.npmjs.com/package/@faster-crud/nest)

---

## The Goal

```ts
// Before: entity + DTO + controller + service = ~100 lines per resource

// After:
@Resource('posts')
class Post {
  @Col() title: string;

  @Col()
  @Searchable()
  content: string;

  @Readonly()
  @Col() createdAt: Date;

  @Hidden('list')
  @Col() internalNote: string;
}
```

That's it. Register it in the module, and you get `POST /posts`, `GET /posts`, `GET /posts/:id`, `PATCH /posts/:id`, `DELETE /posts/:id` — with validation, Swagger docs, and field-level access control.

---

## Architecture

The system is split into three layers:

```
@faster-crud/core     ←  decorators + metadata schema (no NestJS dependency)
@faster-crud/nest     ←  NestJS integration: controller factory, DTO builder, Swagger
@faster-crud/typeorm  ←  TypeORM service implementation
@faster-crud/prisma   ←  Prisma service implementation
... (drizzle, mongoose, etc.)
```

The core has zero framework dependencies. The NestJS package knows about NestJS. The ORM packages know about their respective ORMs. This means you can use the decorator system with any backend — there's also a Hono adapter, an Express adapter, etc.

---

## Metadata Collection: `reflect-metadata` and Two-Pass Decoration

TypeScript decorators run at class definition time, in a specific order: property decorators fire before the class decorator. This is the key insight the entire system is built on.

### Property Decorator (`@Col`)

```ts
export function Col(options: ColOptions = {}): PropertyDecorator {
  return (target, key) => {
    // Read TypeScript's emitted type metadata
    const type = Reflect.getMetadata('design:type', target, key);

    // Accumulate into the class prototype's field registry
    const fields = Reflect.getMetadata(FIELDS_META, target) ?? {};
    fields[key as string] = {
      key: key as string,
      type: type?.name ?? 'any',
      ...options,
    };
    Reflect.defineMetadata(FIELDS_META, fields, target);
  };
}
```

When TypeScript compiles with `emitDecoratorMetadata: true`, it emits calls like:

```js
Reflect.metadata("design:type", String)
```

for each decorated property. `@Col` reads this to know that `title` is a `String`, `createdAt` is a `Date`, etc. — without you writing type annotations twice.

### Class Decorator (`@Resource`)

```ts
export function Resource(name: string, options = {}): ClassDecorator {
  return (target) => {
    // By the time this runs, all @Col decorators have already fired
    const fields = Reflect.getMetadata(FIELDS_META, target.prototype) ?? {};

    const meta: ResourceMeta = {
      name,
      operations: options.operations ?? ['create', 'list', 'get', 'update', 'remove'],
      guardTokens: options.guardTokens,
      pagination: options.pagination ?? { max: 100 },
      fields,  // ← already fully populated
    };

    Reflect.defineMetadata(RESOURCE_META, meta, target);
  };
}
```

`@Resource` runs last and finds a fully-populated field registry waiting for it. The two-pass order is guaranteed by the spec — no orchestration needed.

### Other Field Decorators

Each field behavior is a separate decorator that writes into the same metadata slot:

```ts
@Deny('create', 'update')   // field is read-only
@Hidden('list')              // omit from list responses
@Searchable()                // include in search queries
@Ignore()                    // exclude from all CRUD
@AdminOnly('update')         // restrict operation to admins
```

All of them follow the same pattern: read the current `FIELDS_META`, mutate the entry for the current key, write it back. Because metadata is accumulated by reference, decoration order within a property doesn't matter.

---

## Runtime DTO Generation

NestJS validation (`class-validator`) and Swagger (`@nestjs/swagger`) both work through class instances decorated at class-definition time. The problem: we don't define separate DTO classes — we need to synthesize them at runtime from our metadata.

```ts
export function buildDto(Entity: Function, operation: 'create' | 'update') {
  // Create an anonymous class
  class DynamicDto {}

  // Give it a meaningful name for error messages and Swagger
  Object.defineProperty(DynamicDto, 'name', {
    value: `${Entity.name}${operation === 'create' ? 'Create' : 'Update'}Dto`,
    configurable: true,
  });

  // Iterate the field metadata collected by @Col et al.
  const fields = getFieldsMeta(Entity);
  for (const [key, fieldMeta] of Object.entries(fields)) {
    // Skip fields that are denied for this operation
    if (fieldMeta.ignore) continue;
    if (fieldMeta.deny?.includes(operation)) continue;

    // Register the property on the prototype
    Object.defineProperty(DynamicDto.prototype, key, {
      configurable: true, enumerable: true, writable: true, value: undefined,
    });

    // Emit the type metadata NestJS pipes/Swagger expect
    Reflect.defineMetadata('design:type', resolveFieldType(fieldMeta), DynamicDto.prototype, key);

    // Apply class-validator decorators programmatically
    applyValidationDecorators(DynamicDto.prototype, key, fieldMeta);

    // Apply Swagger decorators programmatically
    applySwaggerToField(DynamicDto.prototype, key, fieldMeta);
  }

  return DynamicDto;
}
```

The key trick: `Reflect.defineMetadata('design:type', ...)` is exactly what TypeScript emits for decorated properties. By writing it manually, we make the dynamic class indistinguishable from a statically-defined DTO as far as NestJS's reflection infrastructure is concerned.

DTOs are cached in a `WeakMap<Function, ...>` keyed on the entity class, so they're only built once per entity.

---

## Controller Factory

NestJS routes are normally defined declaratively with `@Get()`, `@Post()` etc. These are decorators — so they can be applied programmatically, after the fact.

```ts
export class CrudControllerFactory {
  static create(entity: Function, ServiceClass: Type<any>): Type<any> {
    const meta = getResourceMeta(entity);
    const createDto = buildDto(entity, 'create');
    const updateDto = buildDto(entity, 'update');

    // 1. Define the controller class dynamically
    @Controller(meta.name)
    class CrudController {
      constructor(@Inject(ServiceClass) readonly service: any) {}
    }

    // 2. Add only the operations declared in @Resource(name, { operations: [...] })
    if (meta.operations.includes('create')) {
      const descriptor = {
        value: async function(this: any, body: any) {
          return this.service.create(body);
        },
        writable: true, configurable: true,
      };

      // Apply NestJS decorators imperatively
      Post()(CrudController.prototype, 'create', descriptor);
      Body()(CrudController.prototype, 'create', 0);
      Object.defineProperty(CrudController.prototype, 'create', descriptor);

      // Wire the DTO class so ValidationPipe and Swagger see it
      Reflect.defineMetadata(
        'design:paramtypes',
        [createDto],
        CrudController.prototype,
        'create'
      );
    }

    // ... list, get, update, remove follow the same pattern

    // Mark as injectable so NestJS DI works
    Injectable()(CrudController);

    return CrudController;
  }
}
```

The controller is returned as a class — NestJS can't tell it wasn't written by hand. The DI container resolves `ServiceClass` normally, Swagger picks up the DTO types, `ValidationPipe` validates request bodies.

---

## NestJS Module Integration

```ts
@Module({})
export class NestCrudModule {
  static forFeature(registrations: ResourceRegistration[]): DynamicModule {
    const controllers = registrations.map(({ entity, service }) =>
      CrudControllerFactory.create(entity, service)
    );

    return {
      module: NestCrudModule,
      controllers,
      providers: registrations.map(r => r.service),
    };
  }
}
```

Usage in your app:

```ts
@Module({
  imports: [
    NestCrudModule.forFeature([
      { entity: Post, service: PostService },
      { entity: User, service: UserService },
    ]),
  ],
})
export class AppModule {}
```

`forFeature` is the standard NestJS dynamic module pattern. It returns a `DynamicModule` with the synthesized controllers already in the `controllers` array — NestJS registers them as if they were written normally.

---

## Type Safety Design

The framework is intentionally split across two concerns:

**Structural type safety (TypeScript)**: The `IResourceService<T>` interface constrains what a service must implement:

```ts
interface IResourceService<T> {
  create(dto: Partial<T>): Promise<T>;
  list(query: ListQuery): Promise<{ data: T[]; total: number }>;
  get(id: number): Promise<T>;
  update(id: number, dto: Partial<T>): Promise<T>;
  remove(id: number): Promise<void>;
}
```

ORM adapters implement this interface — TypeORM, Prisma, Drizzle, etc. The controller factory always calls methods through this shape.

**Runtime type safety**: `class-validator` validation is applied to DTOs dynamically. If your `@Col` has `{ required: true, maxLength: 100 }`, the generated DTO will have `@IsNotEmpty()` and `@MaxLength(100)` applied — without you writing a separate DTO class.

The one gap: TypeScript can't infer that `Post.title: string` maps to `PostCreateDto.title: string` at compile time, because the DTO doesn't exist at compile time. This is a fundamental limitation of runtime code generation. In practice it's not a problem — the controller typings cover the external API surface, and the internal wiring is tested.

---

## Swagger Integration

Swagger support is optional — the package checks for `@nestjs/swagger` at runtime via `require()`:

```ts
function isSwaggerAvailable(): boolean {
  try { require('@nestjs/swagger'); return true; }
  catch { return false; }
}
```

If available, `@ApiProperty()` with the correct type and metadata is applied to each DTO field. `@ApiTags()` and `@ApiOperation()` are applied to the controller. The Swagger UI reflects the full resource shape with no extra work.

---

## Design Principles

**Annotation, not inheritance**: You don't extend a `BaseCrudEntity` or `CrudController`. You annotate a plain class. The framework reads the annotations and generates code around them without touching the class itself.

**Zero lock-in on the entity**: The `@Resource`/`@Col` decorators live in `@faster-crud/core`, which has no NestJS or ORM dependencies. Your entity class can be used outside the CRUD framework, passed to other systems, or migrated to a different adapter without changing the annotations.

**ORM adapters are thin**: Each ORM adapter (`@faster-crud/typeorm`, `@faster-crud/prisma`, etc.) is a small package that implements `IResourceService<T>` using the native ORM API. They don't re-invent query building — they delegate to what the ORM already does well.

**Graceful degradation**: `class-validator` and `@nestjs/swagger` are optional peer dependencies. The framework works without them — you just don't get automatic validation or Swagger docs. No crashes, no configuration required.
