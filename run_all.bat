@echo off
start "Server" cmd /k "cd server && npm start"
start "Client" cmd /k "cd client && npm run dev"
echo Application starting in new windows...
