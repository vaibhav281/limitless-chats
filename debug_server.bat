@echo off
cd server
call npm start > ../server_debug.log 2>&1
