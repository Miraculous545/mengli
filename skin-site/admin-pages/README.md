# 皮肤站后台插件页补丁

这两个文件来自制作梦璃后台入口时的本地工作副本，基于当时的 `swust-skin-java` 版本，新增了 `/admin/plugin/<id>` 路由和插件页嵌入逻辑。

上游仓库后来有多次更新；部署前必须以最新 `public/assets/js/pages/admin.js` 和 `plugin.js` 为基准重新合并，不建议直接覆盖线上文件。
