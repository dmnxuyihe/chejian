# Windows免安装演示包

适用于Windows 10/11 x64，包含应用源码、生产依赖、Node.js、独立PostgreSQL、当前PC1完整数据库及记录附件、演示操作手册和导入资料。不需要另装Node.js或PostgreSQL；数据库不注册系统服务，仅监听本机。

解压后双击“启动演示.bat”，首次建库并恢复随包种子；后续启动保留已有数据。结束时使用“停止演示.bat”。“备份数据库.bat”生成包含图片视频的完整PostgreSQL备份，需在服务运行时使用。“检查演示.bat”显示实际地址和数据统计。

迁移后续新增数据时，在原电脑运行中生成.dump完整备份；另一台电脑全新解压本包、尚未启动前，将备份复制为seed/current-demo.dump，再启动即可恢复。此方法不覆盖已初始化目录，旧目录及原始备份保留。

默认网页端口5193、数据库端口55432，冲突时自动选择附近空闲端口。`config.json`可配置端口；`mode=external`和`databaseUrl`可连接已有PostgreSQL，已有应用数据区不会被随包种子覆盖。不要填写原电脑密码再分发配置文件。

中文路径兼容通过当前用户可写的ASCII路径入口实现。该入口仅为指向解压目录的Windows junction，实际数据库文件仍保存在解压目录data中，不复制到原有PostgreSQL服务。无法建立入口时提示解压到纯英文可写路径。

运行库许可证随包保留。VC release运行库采用app-local DLL，support另附Redistributable用于必要时修复运行环境。原机器.env、数据库原始目录、开发浏览器依赖和Git认证信息不进入分发包。

重建入口为`scripts/build-portable.py`，参数指定Node可执行文件、PostgreSQL安装目录、Node许可证、演示资料和新的输出目录。`scripts/export-portable-seed.mjs`使用pg_dump只导出当前应用schema，不导出集群角色或原连接配置。`scripts/portable-launcher.mjs`处理独立库初始化、原子恢复、启动、停止、备份和配置。

`tests/portable_package_ui.py`在全新复制目录运行，移除原数据库环境变量，并将PATH限制为Windows System32，验证自带运行时、中文空格路径、重复启动、两车导入、图片视频回读、真实新数据写入、完整备份、停止、重启保留及默认端口冲突处理。不会改动原演示数据库。
