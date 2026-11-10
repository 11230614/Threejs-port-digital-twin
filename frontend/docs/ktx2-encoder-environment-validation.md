# KTX2 第五阶段：编码工具环境验证

验证日期：2026-11-09

## 总结

状态：**BLOCKED**

当前 Windows 环境未安装可执行的 `basisu` 或 `toktx` 编码器。已从官方 Basis Universal 仓库获取源码并确认版本，但本机没有可用的 CMake、MSVC、MinGW 或其他 C++ 编译工具链，官方仓库当前源码快照也没有随仓库提供 Windows x64 `basisu.exe`。因此没有使用来源不明的第三方二进制，也没有开始正式模型转换。

## 环境检查

| 项目 | 结果 | 状态 |
|---|---|---|
| Windows | Windows 10.0.19045.0 | PASS |
| 系统架构 | x64 | PASS |
| PowerShell | 当前 PowerShell 可运行，版本信息已采集 | PASS |
| `basisu` | 未找到 | BLOCKED |
| `toktx` / KTX-Software | 未找到 | BLOCKED |
| `gltf-transform` / `gltf-pipeline` | 未找到 | BLOCKED |
| CMake | 未找到 | BLOCKED |
| MSVC / `cl` / `msbuild` | 未找到 | BLOCKED |
| MinGW / `g++` | 未找到 | BLOCKED |

项目依赖中的 `three/examples/jsm/libs/basis/` 仅包含运行时 transcoder JS/WASM，不包含 PNG/JPEG 编码器。

## 官方来源检查

- 官方仓库：[BinomialLLC/basis_universal](https://github.com/BinomialLLC/basis_universal)
- 获取方式：官方 Git 仓库浅克隆到系统临时目录，未写入项目。
- 源码提交：`073eb6a0a34a23d77e75e54f41dcd9653a52da83`
- 官方 README 标识：Basis Universal v2.5。
- 仓库包含 `basisu.sln`、`basisu.vcxproj` 和 `CMakeLists.txt`，但未发现已构建的 `basisu.exe`。
- 官方 AppVeyor 项目历史可访问，但未能通过公开 artifact URL 获取可复核的 Windows 可执行文件，因此未下载或执行未知路径的二进制。

## 实际执行的检查命令

```powershell
Get-Command basisu,toktx,ktx2check,cmake,git,msbuild
git clone --depth 1 https://github.com/BinomialLLC/basis_universal.git <system-temp-dir>
git -C <system-temp-dir> log -1 --format='%H%n%ad' --date=iso-strict
Get-ChildItem <system-temp-dir> -Recurse -Filter basisu.exe
```

结果：源码获取成功，`basisu.exe`、CMake 和本机 C++ 编译器均不存在。

## 合成纹理编码测试

状态：**NOT TESTED**

由于没有可执行编码器，本阶段没有创建或编码 BaseColor/Normal 合成 PNG，也没有生成 KTX2 输出。以下结果不能宣称通过：

- BaseColor ETC1S/UASTC 编码：NOT TESTED
- Normal 非颜色纹理编码：NOT TESTED
- Mipmap 生成：NOT TESTED
- 编码耗时与输出体积：NOT TESTED
- KTX2 文件头和结构解析：NOT TESTED
- 独立 KTX2 检查工具验证：NOT TESTED

## 最小解阻方案

推荐下一步在用户确认后安装官方 Visual Studio Build Tools（C++ Desktop workload）和官方 CMake，或提供可验证 SHA-256 的官方 Windows x64 `basisu.exe`。随后在项目外构建/安装到用户级目录，例如：

```text
%LOCALAPPDATA%\KTX-Tools\BasisUniversal\
```

完成后应使用绝对路径执行 `basisu.exe --help`、版本检查，并只在系统临时目录对 256×256 BaseColor 与 Normal PNG 做编码测试。不能把源码克隆目录、构建产物或临时纹理加入项目 Git。

## 项目完整性

- 未修改正式 GLB、PNG/JPEG、PortRuntime、AssetManager、KTX2Loader 或 package.json。
- 未转换 `crane_harbour2.glb`。
- 未安装 npm 依赖。
- 项目外源码临时目录不属于 Git 工作区。
- 后续应再次执行 `git status --short` 和 `git diff --check`，确认仅保留本报告等本阶段文档变更。
