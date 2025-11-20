@echo off
echo ========================================
echo 备份 Reader3 数据库
echo ========================================
echo.

REM 创建backups文件夹
if not exist backups mkdir backups

REM 生成带时间戳的文件名
set datetime=%date:~0,4%%date:~5,2%%date:~8,2%_%time:~0,2%%time:~3,2%%time:~6,2%
set datetime=%datetime: =0%

REM 备份数据库
copy reader_data.db backups\reader_data_%datetime%.db

echo.
echo ✓ 备份完成！
echo 文件: backups\reader_data_%datetime%.db
echo.

REM 显示backups文件夹内容
echo 现有备份:
dir /b backups\*.db

echo.
echo ========================================
pause
