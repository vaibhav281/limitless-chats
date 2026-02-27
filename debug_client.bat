@echo off
cd client
call npm run dev > ../client_debug.log 2>&1
