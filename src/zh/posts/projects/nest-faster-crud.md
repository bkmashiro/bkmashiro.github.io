---
title: "nest-faster-crud：NestJS 零样板代码的 CRUD"
date: 2026-03-14
tags: [nestjs, typescript, decorator, crud, backend]
description: "我如何构建一个装饰器驱动的 NestJS CRUD 框架——元数据收集、运行时 DTO 生成、Controller 工厂，以及背后的设计决策。"
readingTime: true
tag:
  - NestJS
  - TypeScript
  - 后端
  - 装饰器
  - 框架
outline: [2, 3]
---

在 NestJS 里写 CRUD 每次都是一样的样板代码。实体类、DTO 类、带五条路由的 Controller、带五个方法的 Service。乘以二十个资源，你就有了一千行全都长得一样的代码。

`nest-faster-crud` 是我对更声明式方法的尝试：注解实体类，注册它，框架处理其余的一切。

- GitHub：[bkmashiro/nest-faster-crud](https://github.com/bkmashiro/nest-faster-crud)
- npm：[@faster-crud/nest](https://www.npmjs.com/package/@faster-crud/nest)

---

## 目标

```ts
// 之前：实体 + DTO + Controller + Service = 每个资源约 100 行

// 之后：
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

就这些。在模块里注册它，你就得到了 `POST /posts`、`GET /posts`、`GET /posts/:id`、`PATCH /posts/:id`、`DELETE /posts/:id`——带验证、Swagger 文档和字段级访问控制。

---

## 架构

系统分为三层：

```
@faster-crud/core     ←  装饰器 + 元数据 schema（无 NestJS 依赖）
@faster-crud/nest     ←  NestJS 集成：Controller 工厂、DTO 构建器、Swagger
@faster-crud/typeorm  ←  TypeORM Service 实现
@faster-crud/prisma   ←  Prisma Service 实现
... （drizzle, mongoose 等）
```

核心没有任何框架依赖。NestJS 包知道 NestJS，ORM 包知道各自的 ORM。这意味着你可以在任何后端使用装饰器系统——还有 Hono 适配器、Express 适配器等。

---

## 元数据收集：`reflect-metadata` 与两遍装饰

TypeScript 装饰器在类定义时以特定顺序运行：属性装饰器在类装饰器之前触发。整个系统就建立在这个关键洞见上。

### 属性装饰器（`@Col`）

```ts
export function Col(options: ColOptions = {}): PropertyDecorator {
  return (target, key) => {
    // 读取 TypeScript 输出的类型元数据
    const type = Reflect.getMetadata('design:type', target, key);

    // 累积到类原型的字段注册表中
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

当 TypeScript 使用 `emitDecoratorMetadata: true` 编译时，它会为每个被装饰的属性输出类似 `Reflect.metadata("design:type", String)` 的调用。`@Col` 读取这个来知道 `title` 是 `String`、`createdAt` 是 `Date` 等——不需要你写两遍类型注解。

### 类装饰器（`@Resource`）

```ts
export function Resource(name: string, options = {}): ClassDecorator {
  return (target) => {
    // 当这里运行时，所有 @Col 装饰器已经触发
    const fields = Reflect.getMetadata(FIELDS_META, target.prototype) ?? {};

    const meta: ResourceMeta = {
      name,
      operations: options.operations ?? ['create', 'list', 'get', 'update', 'remove'],
      guardTokens: options.guardTokens,
      pagination: options.pagination ?? { max: 100 },
      fields,  // ← 已经完全填充
    };

    Reflect.defineMetadata(RESOURCE_META, meta, target);
  };
}
```

`@Resource` 最后运行，发现一个已经填充完毕的字段注册表在等着它。两遍顺序由规范保证——不需要任何编排。

---

## 运行时 DTO 生成

NestJS 的验证（`class-validator`）和 Swagger（`@nestjs/swagger`）都通过类定义时的装饰类实例工作。问题在于：我们不定义单独的 DTO 类——我们需要在运行时从元数据中合成它们。

```ts
export function buildDto(Entity: Function, operation: 'create' | 'update') {
  // 创建一个匿名类
  class DynamicDto {}

  // 给它一个有意义的名字，用于错误信息和 Swagger
  Object.defineProperty(DynamicDto, 'name', {
    value: `${Entity.name}${operation === 'create' ? 'Create' : 'Update'}Dto`,
    configurable: true,
  });

  // 遍历 @Col 等收集的字段元数据
  const fields = getFieldsMeta(Entity);
  for (const [key, fieldMeta] of Object.entries(fields)) {
    if (fieldMeta.ignore) continue;
    if (fieldMeta.deny?.includes(operation)) continue;

    // 在原型上注册属性
    Object.defineProperty(DynamicDto.prototype, key, {
      configurable: true, enumerable: true, writable: true, value: undefined,
    });

    // 输出 NestJS 管道/Swagger 期望的类型元数据
    Reflect.defineMetadata('design:type', resolveFieldType(fieldMeta), DynamicDto.prototype, key);

    // 以编程方式应用 class-validator 装饰器
    applyValidationDecorators(DynamicDto.prototype, key, fieldMeta);

    // 以编程方式应用 Swagger 装饰器
    applySwaggerToField(DynamicDto.prototype, key, fieldMeta);
  }

  return DynamicDto;
}
```

关键技巧：`Reflect.defineMetadata('design:type', ...)` 正是 TypeScript 为被装饰属性输出的内容。通过手动写入它，我们让动态类在 NestJS 反射基础设施看来与静态定义的 DTO 无法区分。

DTO 缓存在以实体类为键的 `WeakMap` 中，所以每个实体只构建一次。

---

## Controller 工厂

NestJS 路由通常用 `@Get()`、`@Post()` 等声明式定义，这些是装饰器——所以它们可以在事后以编程方式应用。

```ts
export class CrudControllerFactory {
  static create(entity: Function, ServiceClass: Type<any>): Type<any> {
    const meta = getResourceMeta(entity);
    const createDto = buildDto(entity, 'create');
    const updateDto = buildDto(entity, 'update');

    // 动态定义 Controller 类
    @Controller(meta.name)
    class CrudController {
      constructor(@Inject(ServiceClass) readonly service: any) {}
    }

    // 只添加 @Resource(name, { operations: [...] }) 中声明的操作
    if (meta.operations.includes('create')) {
      const descriptor = {
        value: async function(this: any, body: any) {
          return this.service.create(body);
        },
        writable: true, configurable: true,
      };

      Post()(CrudController.prototype, 'create', descriptor);
      Body()(CrudController.prototype, 'create', 0);
      Object.defineProperty(CrudController.prototype, 'create', descriptor);

      // 绑定 DTO 类，使 ValidationPipe 和 Swagger 能识别它
      Reflect.defineMetadata(
        'design:paramtypes',
        [createDto],
        CrudController.prototype,
        'create'
      );
    }

    // ... list, get, update, remove 遵循相同模式

    Injectable()(CrudController);

    return CrudController;
  }
}
```

Controller 作为类返回——NestJS 无法判断它不是手写的。DI 容器正常解析 `ServiceClass`，Swagger 获取 DTO 类型，`ValidationPipe` 验证请求体。

---

## NestJS 模块集成

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

在你的应用中使用：

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

`forFeature` 是标准的 NestJS 动态模块模式。它返回一个 `DynamicModule`，其中合成的 Controllers 已经在 `controllers` 数组中——NestJS 像注册普通 Controller 一样注册它们。

---

## 设计原则

**注解，而非继承**：你不需要继承 `BaseCrudEntity` 或 `CrudController`，只需注解一个普通类。框架读取注解，在类外围生成代码，不触碰类本身。

**对实体零锁定**：`@Resource`/`@Col` 装饰器在 `@faster-crud/core` 中，没有 NestJS 或 ORM 依赖。你的实体类可以在 CRUD 框架外使用，传递给其他系统，或者在不改变注解的情况下迁移到不同的适配器。

**ORM 适配器是薄的**：每个 ORM 适配器（`@faster-crud/typeorm`、`@faster-crud/prisma` 等）都是一个小包，使用原生 ORM API 实现 `IResourceService<T>`。它们不重新发明查询构建——它们委托给 ORM 已经做得很好的东西。

**优雅降级**：`class-validator` 和 `@nestjs/swagger` 是可选的对等依赖。没有它们框架也能工作——只是不会有自动验证或 Swagger 文档。不崩溃，不需要配置。
