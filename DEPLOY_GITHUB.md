# 把记账 App 部署到 GitHub Pages（免费 · 手机可当 App 用）

本篇是手把手版。做完你会拿到一个网址，例如
`https://你的用户名.github.io/ledger/`，
用 iPhone Safari 打开 → 分享 → 添加到主屏幕，就和 App 一样。

> 你电脑上的 `git` 已经装好，仓库也已在本地建好并完成首次提交（分支 `main`）。
> 你只需要做下面 **第 1 步注册 GitHub** 和 **第 3 步创建仓库** 这两件需要你自己账号的事。

---

## 第 1 步：注册 / 登录 GitHub

1. 打开 https://github.com ，没有账号就点 **Sign up** 注册（免费，需要邮箱验证）。
2. 已有账号直接 **Sign in**。

## 第 2 步：确认 git 身份（只需一次）

打开终端（Git Bash / PowerShell 都行），执行下面两行，把邮箱和名字换成你自己的：

```bash
git config --global user.name "你的名字"
git config --global user.email "你的邮箱@example.com"
```

## 第 3 步：在 GitHub 上新建一个空仓库

1. 右上角 **+** → **New repository**。
2. **Repository name** 填 `ledger`（或任意名字，比如 `jizhang`）。
3. 可见性选 **Public**（私有仓库用 Pages 需要付费；公开也没关系，**你的账本数据不在代码里**，在 Supabase 的 RLS 保护下）。
4. **不要**勾选 "Add a README file" / .gitignore / license（留空，避免和本地冲突）。
5. 点 **Create repository**。
6. 创建后会看到一页命令提示。记下你的仓库地址，形如：
   `https://github.com/你的用户名/ledger.git`

## 第 4 步：把本地代码推上去

在终端里执行（**把 `你的用户名` 换成你的 GitHub 用户名**）：

```bash
cd /c/Users/lujia/WorkBuddy/2026-09-23-15-46-47

git remote add origin https://github.com/你的用户名/ledger.git

git push -u origin main
```

- 第一次推送会弹窗要求**登录 GitHub**：推荐选 **Sign in with your browser**（浏览器授权，最省事）。
- 如果命令行登录麻烦，也可以用 **Personal Access Token** 当密码：
  GitHub → 头像 → **Settings** → **Developer settings** → **Personal access tokens** → **Tokens (classic)** → **Generate new token**，
  勾选 **repo** 权限，生成后复制那串 `ghp_...`，在提示输入密码时粘贴它（不是你的登录密码）。

推送成功后刷新 GitHub 仓库页面，就能看到所有文件了。

## 第 5 步：开启 GitHub Pages

1. 进入仓库 → 顶部 **Settings**。
2. 左侧菜单找到 **Pages**。
3. **Source** 选 **Deploy from a branch**。
4. **Branch** 选 **main**，目录选 **/ (root)**，点 **Save**。
5. 等 1～2 分钟（页面刷新几次），顶部会出现你的网址：

   ```
   https://你的用户名.github.io/ledger/
   ```

## 第 6 步：在 iPhone 上装成 App

1. 用 **Safari** 打开上面那个网址（注意：iOS 的 PWA 添加到主屏幕必须用 Safari）。
2. 点底部 **分享** 按钮 → **添加到主屏幕** → 命名（如「记账」）→ **添加**。
3. 之后从主屏幕图标打开，就是全屏 App 体验，且支持离线。
4. 在 App 里进 **我的 → 云端同步 → 配置云端**，填入你的 Supabase URL 与 anon key，登录同一邮箱即可多设备同步。

> ⚠️ PWA / Service Worker 需要 **HTTPS**，GitHub Pages 默认就是 HTTPS，所以可以直接用。
> 手机上如果打不开，检查一下网址末尾有没有斜杠 `/`，它应该是 `.../ledger/`。

---

## 以后怎么更新

改完代码后（比如我帮你改了功能），只要三步：

```bash
cd /c/Users/lujia/WorkBuddy/2026-09-23-15-46-47
git add -A
git commit -m "说明这次改了什么"
git push
```

GitHub Pages 会在 1～2 分钟内自动重新发布。
手机上打开 App 若还是旧界面，**下拉刷新**或杀掉 Safari 重新打开即可（Service Worker 会拉新版本）。

---

## 常见问题

- **推送时提示 `remote origin already exists`**：说明已经加过了，改用
  `git remote set-url origin https://github.com/你的用户名/ledger.git`。
- **提示 `Authentication failed`**：见第 4 步的 Token 方法。
- **Pages 打开是 404**：确认 Branch 是 `main`、目录是 `/ (root)`，且 `index.html` 在仓库根目录（本项目的确在根目录）；再等 1～2 分钟。
- **仓库名想换**：Settings → 最上方 **Rename**；改完网址会变，需重新添加到主屏幕。
- **数据会上传到 GitHub 吗？** 不会。GitHub 只放**代码**；你的账本数据存在 iPhone 本地 + 你选的 Supabase 云端。
