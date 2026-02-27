@echo off
echo IPCONFIG OUTPUT: > info.txt
ipconfig >> info.txt
echo. >> info.txt
echo MONGODB STATUS: >> info.txt
tasklist /FI "IMAGENAME eq mongod.exe" >> info.txt
echo. >> info.txt
echo NPM VERSION: >> info.txt
call npm -v >> info.txt 2>&1
