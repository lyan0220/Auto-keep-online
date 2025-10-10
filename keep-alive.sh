#!/usr/bin/env bash
# =========================================================
# 描述: 下载文件修改所需变量和保活url，上传到vps运行脚本
# =========================================================

# -------------------------- 1. 用户配置 --------------------------
CRON_SCHEDULE="*/5 * * * *"     # 保活任务频率：每 5 分钟 (CST/GMT+8)
CLEANUP_SCHEDULE="5 0 * * *"    # 清理任务频率：每天 00:05 (CST/GMT+8)
TG_TOKEN=""  # Telegram Bot Token（可留空）
TG_ID=""  # Telegram Chat ID（可留空）

# 24小时不间断访问
URLS=(
  "https://www.bing.com"
  "https://www.bing.com"
)

# 排除特定时段凌晨1~5点的访问
WEBSITES=(
  "https://www.baidu.com"
  "https://www.baidu.com"
)

# -------------------------- 2. 环境与常量 --------------------------

GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[0;33m'; BLUE='\033[0;34m'; NC='\033[0m'
CRONTAB_MARKER="# AUTO_KEEP_ALIVE_SETUP"

SELF_PATH=$(realpath "$0")
SCRIPT_DIR=$(dirname "$SELF_PATH")
LOG_FILE="${SCRIPT_DIR}/keep-alive.log"
TEMP_LOG_FILE="${SCRIPT_DIR}/keep-alive.tmp.log"

CRON_JOB="${CRON_SCHEDULE} ${SELF_PATH} --run-keep-alive >> ${LOG_FILE} 2>&1"
CLEANUP_JOB="${CLEANUP_SCHEDULE} ${SELF_PATH} --run-cleanup >> ${LOG_FILE} 2>&1"


# -------------------------- 3. 工具函数 --------------------------

log() {
  local level="$1"; shift
  local msg="$*"
  local ts_utc=$(date +%s)
  local ts_cst=$((ts_utc + 28800))
  local ts=$(date -d "@${ts_cst}" '+%Y-%m-%d %H:%M:%S')
  
  local color=""
  case "$level" in
      "SUCCESS"|"OK") color="$GREEN" ;;
      "FAIL"|"ERROR") color="$RED" ;;
      "WARN") color="$YELLOW" ;;
      *) color="$BLUE" ;;
  esac
  
  echo -e "${color}${ts} [${level}] ${msg}${NC}"
}

# 发送 Telegram 通知
notify_tg() {
  [[ -z "$TG_TOKEN" || -z "$TG_ID" ]] && return
  local msg_text="$1"
  curl -s -X POST "https://api.telegram.org/bot${TG_TOKEN}/sendMessage" \
        -d "chat_id=${TG_ID}" \
        --data-urlencode "text=${msg_text}" >/dev/null || true
}

# 随机 UA
get_random_user_agent() {
  local agents=(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/$(shuf -i 100-131 -n 1).0.0.0 Safari/537.36"
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/$(shuf -i 100-131 -n 1).0.0.0 Safari/537.36"
    "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1"
  )
  echo "${agents[RANDOM % ${#agents[@]}]}"
}

# 随机 IPv4
get_random_ip() {
  echo "$((RANDOM % 255)).$((RANDOM % 255)).$((RANDOM % 255)).$((RANDOM % 255))"
}


# -------------------------- 4. 系统检测与安装 --------------------------

install_cron_service() {
  log "WARN" "未找到 crontab 命令，开始自动安装..."

  local install_cmd=""
  local service_cmd=""

  if command -v apk &>/dev/null; then
    install_cmd="apk update && apk add cronie"
    service_cmd="rc-service crond start && rc-update add crond"
  elif command -v apt &>/dev/null; then
    install_cmd="apt update -y && apt install -y cron"
    service_cmd="systemctl enable cron && systemctl start cron"
  elif command -v yum &>/dev/null; then
    install_cmd="yum install -y cronie"
    service_cmd="systemctl enable crond && systemctl start crond"
  elif command -v dnf &>/dev/null; then
    install_cmd="dnf install -y cronie"
    service_cmd="systemctl enable crond && systemctl start crond"
  else
    log "ERROR" "无法识别系统包管理器，请手动安装 Cron 服务。"
    exit 1
  fi

  log "INFO" "正在执行安装命令..."
  sudo sh -c "$install_cmd" || true
  
  log "INFO" "正在尝试启动 Cron 服务..."
  sudo sh -c "$service_cmd" 2>/dev/null || true

  if ! command -v crontab &>/dev/null; then
    log "ERROR" "Cron 服务安装失败。"
    exit 1
  fi

  log "SUCCESS" "Cron 服务已安装并启动。"
}

setup_cron_job() {
  command -v crontab &>/dev/null || install_cron_service

  if crontab -l 2>/dev/null | grep -q "$CRONTAB_MARKER"; then
    log "INFO" "定时任务已存在，无需设置。"
    # 任务已存在时返回，让 main 函数执行后续的保活逻辑 (手动执行)
    return 0 
  else
    (crontab -l 2>/dev/null; echo "$CRONTAB_MARKER"; echo "$CRON_JOB"; echo "$CLEANUP_JOB") | crontab -
    log "SUCCESS" "==========================================="
    log "SUCCESS" "定时任务已成功创建！"
    log "WARN" "1. 保活任务: ${CRON_JOB}"
    log "WARN" "2. 清理任务: ${CLEANUP_JOB}"
    log "WARN" "日志路径: ${LOG_FILE}"
    log "SUCCESS" "==========================================="
    
    # 首次安装成功后，立即执行一次保活任务
    log "INFO" "首次安装完成，准备执行保活任务..."
    run_keep_alive
    
    log "SUCCESS" "本次运行结束，后续将由 Crontab 调度执行。"
    # 安装并执行完成后退出
    exit 0 
  fi
}


# -------------------------- 5. 日志管理 --------------------------

rotate_logs() {
  [[ ! -f "$LOG_FILE" ]] && { log "INFO" "日志文件不存在，跳过清理。"; return; }

  log "INFO" "--- 开始执行每日日志清理 (保留最近 24 小时) ---"

  local cutoff=$(date -d '24 hours ago' +%s 2>/dev/null || echo $(($(date +%s) - 86400))) 

  awk -v cutoff="$cutoff" '{
    clean_line = $0;
    gsub(/\x1b\[[0-9;]*m/, "", clean_line);
    
    split(clean_line, parts, "[][] ");
    time_str = parts[1] " " parts[2]

    cmd = "date -d \""time_str"\" +%s" 
    cmd | getline t
    close(cmd)
    
    if (t > cutoff) print $0
  }' "$LOG_FILE" 2>/dev/null > "$TEMP_LOG_FILE" && mv "$TEMP_LOG_FILE" "$LOG_FILE"

  log "INFO" "--- 日志清理完成 ---"
}


# -------------------------- 6. 请求核心逻辑 --------------------------

make_request() {
  local url="$1"
  local label="$2"
  local ua=$(get_random_user_agent)
  local ip=$(get_random_ip)
  local retries=2

  for ((i=1; i<=retries; i++)); do
    local code
    code=$(curl -s -o /dev/null -w "%{http_code}" -m 30 \
             -H "User-Agent: ${ua}" \
             -H "X-Forwarded-For: ${ip}" \
             -H "X-Real-IP: ${ip}" \
             "${url}") || code=0

    if [[ "$code" == "200" ]]; then
      log "OK" "[${label}] 访问成功: ${url}"
      return
    fi

    sleep 2
  done

  log "FAIL" "[${label}] 访问失败: ${url} 状态码: ${code}"
  notify_tg "保活告警：\nURL: ${url}\n状态码: ${code}"
}


# -------------------------- 7. 主运行流程 --------------------------

run_keep_alive() {
  log "INFO" "--- 开始执行保活任务 ---"
  
  # 1. 强制获取当前的 CST 小时 (UTC + 8小时)
  local ts_utc=$(date +%s)
  local ts_cst=$((ts_utc + 28800))
  local hour=$(date -d "@${ts_cst}" +%H) 
  
  # 24 小时保活列表
  for url in "${URLS[@]}"; do
    make_request "$url" "URLS(24H)"
  done

  # 时段限制 (1~5点暂停)
  if ((10#$hour >= 1 && 10#$hour < 5)); then 
    log "INFO" "当前为 1:00~5:00 时段 (上海时间 $hour:xx)，跳过 WEBSITES 列表。"
  else
    for url in "${WEBSITES[@]}"; do
      make_request "$url" "WEBSITES(工作时段)"
    done
  fi

  log "INFO" "--- 保活任务完成 ---"
}

main() {
  # 确保脚本自身拥有执行权限
  chmod +x "$SELF_PATH" || true

  case "$1" in
    "--run-keep-alive")
      run_keep_alive
      ;;
    "--run-cleanup")
      rotate_logs
      ;;
    *)
      # 2. 用户手动运行（无参数）：执行安装逻辑
      setup_cron_job
      
      # 3. 如果脚本执行到这里，说明任务已存在（setup_cron_job返回0），立即执行保活。
      log "INFO" "检测到 Crontab 任务已存在，自动执行保活任务..."
      run_keep_alive      
      
      log "WARN" "本次手动执行已完成，后续将由 Crontab 调度执行。"
      ;;
  esac
}

main "$@"