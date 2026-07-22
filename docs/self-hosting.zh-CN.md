# Codex Starter 自托管维护指南

本文适合希望从自己的 Git fork 持续维护 `codex-starter`，并在修改源码后手动安装本地版本的用户。

这里的“自托管”是指：源码保存在自己的 fork 和本地 Git 工作区中；测试通过后，通过 npm 将当时的源码复制到全局安装目录。之后修改工作区不会立即影响日常使用的 `codex-starter` 命令。

## Cheat Sheet

首次切换到 self-host：

```bash
# 1. 同步自己的 main
git switch main
git fetch upstream --tags --prune
git merge --ff-only upstream/main
git push origin main

# 2. 安装依赖并测试
npm ci
npm run test:all

# 3. 用当前源码安装一份固定副本
npm install -g . --install-links
rehash

# 4. 验证
codex-starter --version
command -v codex-starter
npm list -g codex-starter --depth=0
```

以后每次修改或同步源码后，运行：

```bash
npm ci
npm run test:all
npm install -g . --install-links
rehash
```

其中 `--install-links` 很重要。单独运行 `npm install -g .` 时，npm 默认可能把全局包链接回当前工作区；加上该参数后，npm 会把本地包打包并复制到全局目录，符合“修改后手动重新安装才生效”的工作方式。

## 前置条件

- Node.js 18 或更高版本
- Node.js 附带的 npm
- Git
- 一个 GitHub fork
- `origin` 指向自己的 fork，`upstream` 指向原作者仓库

检查远端：

```bash
git remote -v
```

如果还没有配置 `upstream`：

```bash
git remote add upstream https://github.com/Bojun-Vvibe/codex-starter.git
```

## 一次性迁移

### 1. 同步上游代码

先确保 `main` 没有未提交的修改：

```bash
git switch main
git status
git fetch upstream --tags --prune
git merge --ff-only upstream/main
git push origin main
```

`--ff-only` 会在主分支已经产生分叉时停止，避免意外制造合并提交。

### 2. 安装依赖并运行测试

```bash
npm ci
npm run test:all
```

只有测试通过后再更新全局命令，日常使用的版本才会保持稳定。

### 3. 清理旧的全局安装

如果以前通过 Bun 全局安装过该命令，只需迁移时清理一次：

```bash
bun remove -g codex-starter
rehash
```

如果使用的是当前仓库注册的 `bun link`，则在仓库根目录执行：

```bash
bun unlink
rehash
```

如果以前已经通过 npm 安装，不必先卸载；下一步会替换同名全局包。若旧安装使用了 `sudo npm install -g`，仅在清理该包时对应执行：

```bash
sudo npm uninstall -g codex-starter
```

之后不要继续使用 `sudo` 安装 npm 全局包；应将 npm prefix 配置到当前用户可写的目录。

### 4. 安装当前源码的固定副本

在仓库根目录执行：

```bash
npm install -g . --install-links
rehash
```

验证：

```bash
codex-starter --version
command -v codex-starter
npm list -g codex-starter --depth=0
realpath "$(command -v codex-starter)"
```

`realpath` 应指向 npm 的全局安装目录，而不是当前 Git 工作区。此后修改 `index.js` 不会立即影响全局命令。

## 日常维护流程

### 同步原作者的新版本

```bash
git switch main
git status
git fetch upstream --tags --prune
git merge --ff-only upstream/main
git push origin main
npm ci
npm run test:all
npm install -g . --install-links
rehash
```

最后一次安装命令负责把刚通过测试的源码更新到全局副本。

### 开发自己的功能

不要直接在 `main` 上开发。为每项改动创建分支：

```bash
git switch main
git switch -c feat/my-change

# 修改并验证代码
npm run test:all

# 更新本机使用的固定副本
npm install -g . --install-links
rehash

git add .
git commit -m "feat: describe my change"
git push -u origin feat/my-change
```

## self-host 模式下不要使用 `--update`

`codex-starter --update` 安装的是 npm registry 中的官方最新版：

```bash
npm install -g codex-starter@latest
```

它不会安装当前工作区的自定义修改。self-host 模式应通过 Git 同步源码，然后重新执行：

```bash
npm ci
npm run test:all
npm install -g . --install-links
rehash
```

## 恢复使用官方版本

```bash
npm install -g codex-starter@latest
rehash
codex-starter --version
```

这不会删除 Git 仓库和个人分支。之后随时可以运行 `npm install -g . --install-links` 切回本地版本。

## 常见问题

### 修改源码后，为什么全局命令没有变化？

这是固定副本模式的预期行为。测试后重新安装：

```bash
npm run test:all
npm install -g . --install-links
rehash
```

### GitHub 已发布新版本，本地为什么还是旧版本？

分别检查 Git 源码、当前全局命令和 registry 版本：

```bash
git describe --tags --always
node -p "require('./package.json').version"
codex-starter --version
npm view codex-starter version
```

这几项在尚未同步源码或重新安装时可以不同。

### npm 全局安装报 `EACCES`

通常是以前通过 `sudo npm install -g` 留下了 root 所有权文件。只清理对应的旧包，然后把 npm prefix 配置到当前用户可写目录；不要递归修改整个系统目录的权限。

### 移动或删除项目目录后，命令还能运行吗？

能。固定副本已经位于 npm 全局目录，不依赖原工作区。只有下一次更新本地版本时，才需要进入新的源码目录重新运行安装命令。
