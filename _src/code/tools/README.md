# 本机工具

- `vineflower-1.11.2.jar`：反编译官方客户端 jar（来自 Maven Central 官方构件）。
- 重新生成源码树（约 2 分钟，产出 7,055 个 Java 文件）：
  ```
  "C:/Users/zht/AppData/Roaming/.minecraft/runtime/java-runtime-epsilon/bin/java.exe" -Xmx4G \
    -jar vineflower-1.11.2.jar -ae G:/ck-web26/client-26.2.jar G:/ck-web26/src-vanilla
  ```
- `make_launch.py` / `launch.args`：以干净 gameDir 启动真实 26.2 客户端截图用（默认不启动）。
