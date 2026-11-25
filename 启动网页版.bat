@echo off
chcp 65001 >nul
title AlgoForge 力扣Hot100教学平台 (网页版)
cd /d "%~dp0"
python server.py
pause
