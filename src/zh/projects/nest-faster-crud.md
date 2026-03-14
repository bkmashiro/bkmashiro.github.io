---
title: "nest-faster-crud：NestJS 零样板 CRUD 框架"
date: 2026-03-14
tags: [nestjs, typescript, 装饰器, crud, 后端]
description: "如何用装饰器驱动的方式构建 NestJS CRUD 框架——元数据收集、运行时 DTO 生成、Controller 工厂，以及背后的设计思路。"
readingTime: true
tag:
  - NestJS
  - TypeScript
  - 后端
  - 装饰器
  - 框架
outline: [2, 3]
---

在 NestJS 里写 CRUD，每次都是一样的样板代码。Entity 类、DTO 类、五个路由的 Controller、五个方法的 Service。乘以二十个资源，就是一千行看起来一模一样的代码。

`nest-faster-crud` 是我对更声明式方案的尝试：给实体类加注解，注册一下，框架负责其余的一切。

- GitHub: [bkmashiro/nest-faster-crud](https://github.com/bkmashiro/nest-faster-crud)
- npm: [@faster-crud/nest](https://www.npmjs.com/package/@faster-crud/nest)

---

## 目标

```ts
// 之前：entity + DTO + controller + service ≈ 每个资源 100 行

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

就这样。在模块里注册一下，你就有了 `POST /posts`、`GET /posts`、`GET /posts/:id`、`PATCH /posts/:id`、`DELETE /posts/:id`——带验证、带 Swagger 文档、带字段级访问控制。

---

## 架构

系统分为三层：

```
@faster-crud/core     ←  装饰器 + 元数据 schema（无 NestJS 依赖）
@faster-crud/nest     ←  NestJS 集成：Controller 工厂、DTO 构建、Swagger
@faster-crud/typeorm  ←  TypeORM service 实现
@faster-crud/prisma   ←  Prisma service 实现
... （drizzle, mongoose 等）
```

core 没有任何框架依赖。NestJS 包知道 NestJS。ORM 包知道各自的 ORM。这意味着你可以在任何后端使用这套装饰器系统——还有 Hono 适配器、Express 适配器等。

---

## 元数据收集：`reflect-metadata` 与两阶段装饰

TypeScript 装饰器在类定义时执行，顺序固定：属性装饰器先于类装饰器触发。整个系统就建立在这个关键认知上。

### 属性装饰器（`@Col`）

```ts
export function Col(options: ColOptions = {}): PropertyDecorator {
  return (target, key) => {
    // 读取 TypeScript 发射的类型元数据
    const type = Reflect.getMetadata('design:type', target, key);

    // 累积到类原型的字段注册表里
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

当 TypeScript 开启 `emitDecoratorMetadata: true` 编译时，会为每个带装饰器的属性发射：

```js
Reflect.metadata("design:type", String)
```

`@Col` 通过这个知道 `title` 是 `String`，`createdAt` 是 `Date`——不需要你把类型写两遍。

### 类装饰器（`@Resource`）

```ts
export function Resource(name: string, options = {}): ClassDecorator {
  return (target) => {
    // 执行到这里时，所有 @Col 装饰器已经跑完了
    const fields = Reflect.getMetadata(FIELDS_META, target.prototype) ?? {};

    const meta: ResourceMeta = {
      name,
      operations: options.operations ?? ['create', 'list', 'get', 'update', 'remove'],
      guardTokens: options.guardTokens,
      pagination: options.pagination ?? { max: 100 },
      fields,  // ← 已经完整填充
    };

    Reflect.defineMetadata(RESOURCE_META, meta, target);
  };
}
```

`@Resource` 最后执行，发现一个已经完整填充好的字段注册表在等着它。这个两阶段顺序由规范保证——不需要任何额外编排。

### 其他字段装饰器

每种字段行为都是一个单独的装饰器，写入同一个元数据槽：

```ts
@Deny('create', 'update')   // 字段只读
@Hidden('list')              // 在列表响应中省略
@Searchable()                // 加入搜索查询
@Ignore()                    // 从所有 CRUD 中排除
@AdminOnly('update')         // 限制操作只对管理员开放
```

所有装饰器遵循同一模式：读当前 `FIELDS_META`，修改当前 key 的条目，写回去。因为元数据是按引用累积的，一个属性上的装饰器顺序无所谓。

---

## 运行时 DTO 生成

NestJS 的验证（`class-validator`）和 Swagger（`@nestjs/swagger`）都依赖在类定义时装饰的类实例。问题是：我们不定义单独的 DTO 类——需要在运行时从元数据合成它们。

```ts
export function buildDto(Entity: Function, operation: 'create' | 'update') {
  // 创建匿名类
  class DynamicDto {}

  // 给它一个有意义的名字，用于错误信息和 Swagger
  Object.defineProperty(DynamicDto, 'name', {
    value: `${Entity.name}${operation === 'create' ? 'Create' : 'Update'}Dto`,
    configurable: true,
  });

  // 遍历 @Col 等收集的字段元数据
  const fields = getFieldsMeta(Entity);
  for (const [key, fieldMeta] of Object.entries(fields)) {
    // 跳过被此操作拒绝的字段
    if (fieldMeta.ignore) continue;
    if (fieldMeta.deny?.includes(operation)) continue;

    // 在原型上注册属性
    Object.defineProperty(DynamicDto.prototype, key, {
      configurable: true, enumerable: true, writable: true, value: undefined,
    });

    // 发射 NestJS 管道/Swagger 期望的类型元数据
    Reflect.defineMetadata('design:type', resolveFieldType(fieldMeta), DynamicDto.prototype, key);

    // 命令式地应用 class-validator 装饰器
    applyValidationDecorators(DynamicDto.prototype, key, fieldMeta);

    // 命令式地应用 Swagger 装饰器
    applySwaggerToField(DynamicDto.prototype, key, fieldMeta);
  }

  return DynamicDto;
}
```

关键技巧：`Reflect.defineMetadata('design:type', ...)` 正是 TypeScript 为装饰属性所发射的内容。手动写入它，让动态类对 NestJS 的反射基础设施来说和静态定义的 DTO 没有区别。

DTO 缓存在以实体类为 key 的 `WeakMap<Function, ...>` 中，所以每个实体只构建一次。

---

## Controller 工厂

NestJS 路由通常用 `@Get()`、`@Post()` 等装饰器声明式定义。这些都是装饰器——所以可以在事后命令式地应用。

```ts
export class CrudControllerFactory {
  static create(entity: Function, ServiceClass: Type<any>): Type<any> {
    const meta = getResourceMeta(entity);
    const createDto = buildDto(entity, 'create');
    const updateDto = buildDto(entity, 'update');

    // 1. 动态定义 controller 类
    @Controller(meta.name)
    class CrudController {
      constructor(@Inject(ServiceClass) readonly service: any) {}
    }

    // 2. 只添加 @Resource(name, { operations: [...] }) 中声明的操作
    if (meta.operations.includes('create')) {
      const descriptor = {
        value: async function(this: any, body: any) {
          return this.service.create(body);
        },
        writable: true, configurable: true,
      };

      // 命令式地应用 NestJS 装饰器
      Post()(CrudController.prototype, 'create', descriptor);
      Body()(CrudController.prototype, 'create', 0);
      Object.defineProperty(CrudController.prototype, 'create', descriptor);

      // 接入 DTO 类，让 ValidationPipe 和 Swagger 能识别
      Reflect.defineMetadata(
        'design:paramtypes',
        [createDto],
        CrudController.prototype,
        'create'
      );
    }

    // ... list, get, update, remove 同理

    // 标记为 injectable，让 NestJS DI 能工作
    Injectable()(CrudController);

    return CrudController;
  }
}
```

Controller 作为类返回——NestJS 无法区分它是不是手写的。DI 容器正常解析 `ServiceClass`，Swagger 识别 DTO 类型，`ValidationPipe` 验证请求体。

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

在你的 app 里使用：

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

`forFeature` 是标准的 NestJS 动态模块模式。返回一个 `DynamicModule`，合成的 controller 已经在 `controllers` 数组里——NestJS 把它们当作普通手写的 controller 注册。

---

## 类型安全设计

框架有意将两个关切分开：

**结构类型安全（TypeScript）**：`IResourceService<T>` 接口约束 service 必须实现的方法：

```ts
interface IResourceService<T> {
  create(dto: Partial<T>): Promise<T>;
  list(query: ListQuery): Promise<{ data: T[]; total: number }>;
  get(id: number): Promise<T>;
  update(id: number, dto: Partial<T>): Promise<T>;
  remove(id: number): Promise<void>;
}
```

ORM 适配器实现这个接口——TypeORM、Prisma、Drizzle 等。Controller 工厂始终通过这个 shape 调用方法。

**运行时类型安全**：`class-validator` 验证被动态应用到 DTO 上。如果你的 `@Col` 有 `{ required: true, maxLength: 100 }`，生成的 DTO 会自动带上 `@IsNotEmpty()` 和 `@MaxLength(100)`——不需要写单独的 DTO 类。

唯一的局限：TypeScript 无法在编译期推断出 `Post.title: string` 映射到 `PostCreateDto.title: string`，因为 DTO 在编译期不存在。这是运行时代码生成的根本限制。实际上不是问题——controller 的类型定义覆盖了外部 API 接口，内部连线通过测试保证。

---

## 设计原则

**注解，而非继承**：你不需要继承 `BaseCrudEntity` 或 `CrudController`。你只是给普通类加注解。框架读取注解并围绕它生成代码，不碰类本身。

**实体类零锁定**：`@Resource`/`@Col` 装饰器在 `@faster-crud/core` 里，没有 NestJS 或 ORM 依赖。你的实体类可以在 CRUD 框架之外使用，传给其他系统，或者迁移到不同的适配器——不需要改任何注解。

**ORM 适配层要薄**：每个 ORM 适配器（`@faster-crud/typeorm`、`@faster-crud/prisma` 等）都是一个小包，用原生 ORM API 实现 `IResourceService<T>`。它们不重新发明查询构建——而是把工作委托给 ORM 本身擅长的事情。

**可选依赖的优雅降级**：`class-validator` 和 `@nestjs/swagger` 是可选的 peer dependency。没有它们框架也能工作——只是没有自动验证和 Swagger 文档。不崩溃，不需要配置。
