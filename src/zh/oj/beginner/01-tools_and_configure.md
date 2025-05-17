---
description: 工具和配置
title: 工具和配置
readingTime: true
tag:
  - OJ
  - 工具
outline: [2, 3]
---


# 超级省流版

## 在 Windows 上安装 WSL2

先装 WSL2. 管理员终端启动：

```
wsl -install [<version>]
```

`win`+`R `运行 `OptionalFeatures`, 勾选 Hyper-V, 虚拟机平台, WSL.

然后等着就行了.

之后启动 WSL2 的终端，等一会就进系统了.

## 配置你的Linux

### 配置网络（如果需要）

敏感话题自行研究

### 配置Git

默认都有自带的 不用装. 参考下面的链接配置SSH, 之后会用上。

https://docs.github.com/en/authentication/connecting-to-github-with-ssh/adding-a-new-ssh-key-to-your-github-account?platform=linux

可选的配置GPG

https://docs.github.com/en/authentication/managing-commit-signature-verification/generating-a-new-gpg-key

配置用户名和email

```bash
git config --global user.name "Your Name"
git config --global user.email "your.email@example.com"
```

注意: 这个邮箱最好是 GitHub 分配的 noreply 邮箱 [Find it here](https://github.com/settings/emails#:~:text=Primary%20email%20address)

### 配置node.js

OJ 跑在 node 平台上,所以要装

可以用 Node Version Manager (NVM)

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
```

然后用`nvm`装`node.js` 18+版本

```bash
nvm i 18
```

== 运行 Leverage

Note: 先配置好SSH，并且把你加进去，才能clone这个组织仓库.

```bash
git clone git@github.com:ThinkSpiritLab/leverage.git
```

后端的包管理器是 `pnpm`，前端是`yarn`

```bash
npm install -g pnpm yarn
cd leverage
pnpm install
cd frontend
yarn install
```
具体的看仓库 readme.

要运行的话还得配置别的东西，咱们之后再研究.