---
article: false
---
# TS类型体操 :: 封装fs

想实现这样的功能：

```ts
await new FileHelper()
    .push('mkdir', basePath)
    .push('write', codePath, code.src)
    .push('chown', codePath, config.uid, config.gid)
    .push('chgrp', codePath, config.uid, config.gid)
    .run()
```

同时操作一堆文件系统的东西，很麻烦

弄了个怪东西

```typescript
type FunctionArgs<T> = T extends (...args: infer Args) => any ? Args : never;

type FileHelperTaskType = keyof typeof FileHelper.map;

type FileHelperTask<T extends FileHelperTaskType> = {
  name: T;
  args: FunctionArgs<typeof FileHelper.map[T]>;
};

export class FileHelper {
  private tasks: FileHelperTask<FileHelperTaskType>[] = [];

  push<T extends FileHelperTaskType>(name: T, ...args: FunctionArgs<typeof FileHelper.map[T]>) {
    this.tasks.push({ name, args });
    return this;
  }
  private finished = []
  async run() {
    for (const task of this.tasks) {
      try {
        await FileHelper.map[task.name].apply(null, task.args);
        this.finished.push(task)
      } catch(err) {
        throw err
      }
    }
  }

  async rollback() {
    for (const task of this.finished.reverse()) {
      try {
        await FileHelper.rollback[task.name]?.apply(null, task.args);
      } catch(err) {
        throw err
      }
    }
  }

  static map = {
    mkdir: async (target: string) => {
      await fs.mkdir(target, { recursive: true });
    },
    write: fs.writeFile,
    chown: fs.chown,
    chgrp: fs.chown,
    chmod: fs.chmod,
    copy: fs.copyFile,
    move: fs.rename,
    delete: fs.unlink,
  };
  
  static rollback = {
    mkdir: deleteNth(0),
    write: deleteNth(0),
    copy:  deleteNth(1),
    move: swapArguments(fs.rename, 1, 0),
  }
}

```

