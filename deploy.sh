#!/usr/bin/env bash
set -euo pipefail

# ───────────────────────── конфиг ─────────────────────────
APP_USER="${APP_USER:-coxerhub}"
DOMAIN="${DOMAIN:-}"
NODE_MAJOR="${NODE_MAJOR:-22}"
APP_PORT="${APP_PORT:-3000}"            # внутренний порт приложения (только 127.0.0.1)
SETUP_UFW="${SETUP_UFW:-yes}"
SETUP_TLS="${SETUP_TLS:-no}"
TLS_EMAIL="${TLS_EMAIL:-}"
SETUP_AUTH="${SETUP_AUTH:-yes}"         # HTTP Basic Auth перед сайтом — .maFile = полный доступ к Steam Guard
AUTH_USER="${AUTH_USER:-admin}"
AUTH_PASS="${AUTH_PASS:-}"              # пусто → сгенерируем (либо переиспользуем существующий)
COXER_PROXY="${COXER_PROXY:-}"          # необязательный глобальный прокси для запросов к Steam
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VAULT_DIR="${VAULT_DIR:-$APP_DIR/maFiles}"   # хранилище .maFile — деплой его НЕ трогает и НЕ удаляет
HTPASSWD="/etc/nginx/.coxerhub.htpasswd"

# ───────────────────────── логирование ─────────────────────────
if [ -t 1 ]; then
  R=$'\e[31m'; G=$'\e[32m'; Y=$'\e[33m'; C=$'\e[36m'; B=$'\e[1m'; N=$'\e[0m'
else R=; G=; Y=; C=; B=; N=; fi
log()  { echo "${G}${B}==>${N} $*"; }
info() { echo "${C}   ·${N} $*"; }
warn() { echo "${Y}   ! $*${N}"; }
die()  { echo "${R}${B}ОШИБКА:${N} $*" >&2; exit 1; }
trap 'die "сбой на строке $LINENO  →  $BASH_COMMAND"' ERR

have() { command -v "$1" >/dev/null 2>&1; }

# ───────────────────────── preflight ─────────────────────────
[ "$(id -u)" -eq 0 ] || die "Запустите с правами root:  sudo bash deploy.sh"
# shellcheck disable=SC1091
. /etc/os-release 2>/dev/null || true
[ "${ID:-}" = "ubuntu" ] || warn "Скрипт рассчитан на Ubuntu/Debian (обнаружено: '${ID:-неизвестно}'). Продолжаю."
[ -f "$APP_DIR/server.js" ] && [ -f "$APP_DIR/package.json" ] \
  || die "Запускайте из корня проекта SDA (нет server.js или package.json). APP_DIR=$APP_DIR"
case "$APP_DIR" in
  /root|/root/*)
    die "Проект лежит в $APP_DIR — сервисный пользователь '$APP_USER' не сможет его прочитать (права /root = 700).
        Перенесите проект и запустите снова, например:
          mv \"$APP_DIR\" /opt/sda && cd /opt/sda && sudo bash deploy.sh" ;;
esac

export DEBIAN_FRONTEND=noninteractive
APT="apt-get -o DPkg::Lock::Timeout=600"
apt_update() { $APT update; }
apt_install() { $APT install -y --no-install-recommends "$@"; }

log "coxerhub (SDA) deploy → $APP_DIR  (пользователь сервиса: $APP_USER, домен: ${DOMAIN:-<IP>})"
apt_update
apt_install ca-certificates curl gnupg openssl

# ───────────────────────── адреса ─────────────────────────
if [ -n "$DOMAIN" ]; then
  if [ "$SETUP_TLS" = "yes" ]; then SCHEME="https"; else SCHEME="http"; fi
  SITE_URL="${SCHEME}://${DOMAIN}"
  SERVER_NAME="${DOMAIN} www.${DOMAIN}"
  [ "$SETUP_TLS" = "yes" ] || warn "DOMAIN задан без SETUP_TLS — сайт по http://${DOMAIN}. Добавьте SETUP_TLS=yes для HTTPS."
else
  SERVER_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"; SERVER_IP="${SERVER_IP:-127.0.0.1}"
  SITE_URL="http://${SERVER_IP}"
  SERVER_NAME="_"
  warn "DOMAIN не задан — деплой по IP ($SERVER_IP). Для HTTPS позже задайте DOMAIN и SETUP_TLS=yes."
fi

# ───────────────────────── Node (NodeSource) ─────────────────────────
install_node() {
  if have node && [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 18 ]; then
    log "Node уже установлен ($(node -v)) — пропускаю"; return
  fi
  log "Установка Node ${NODE_MAJOR} LTS (NodeSource)…"
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt_install nodejs
}
install_node
NODE_BIN="$(command -v node)"
info "Node: $(node -v),  npm: $(npm -v)"

# ───────────────────────── nginx ─────────────────────────
log "nginx…"
apt_install nginx
[ "$SETUP_AUTH" = "yes" ] && apt_install apache2-utils   # htpasswd

# ───────────────────────── системный пользователь ─────────────────────────
if ! id -u "$APP_USER" >/dev/null 2>&1; then
  log "Создаю пользователя $APP_USER"
  useradd --system --create-home --shell /usr/sbin/nologin "$APP_USER"
fi

# ───────────────────────── хранилище .maFile (переживает рестарты/редеплой) ─────────────────────────
log "Хранилище .maFile: $VAULT_DIR (не удаляется деплоем)"
mkdir -p "$VAULT_DIR"
chown -R "$APP_USER:$APP_USER" "$VAULT_DIR"
chmod 700 "$VAULT_DIR"

# ───────────────────────── права на проект + зависимости ─────────────────────────
chown -R "$APP_USER:$APP_USER" "$APP_DIR"
runuser_app() { sudo -u "$APP_USER" env PATH="/usr/local/bin:/usr/bin:/bin" "$@"; }

log "Установка зависимостей (только prod: express, undici)"
if [ -f "$APP_DIR/package-lock.json" ]; then
  runuser_app bash -c "cd '$APP_DIR' && npm ci --omit=dev --no-audit --no-fund" \
    || runuser_app bash -c "cd '$APP_DIR' && npm install --omit=dev --no-audit --no-fund"
else
  runuser_app bash -c "cd '$APP_DIR' && npm install --omit=dev --no-audit --no-fund"
fi

# ───────────────────────── systemd: coxerhub ─────────────────────────
PROXY_LINE=""
[ -n "$COXER_PROXY" ] && PROXY_LINE="Environment=COXER_PROXY=${COXER_PROXY}"

log "systemd-юнит coxerhub.service (node server.js, слушает 127.0.0.1:${APP_PORT})"
cat > /etc/systemd/system/coxerhub.service <<UNIT
[Unit]
Description=coxerhub — Steam Guard manager (SDA)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${APP_USER}
Group=${APP_USER}
WorkingDirectory=${APP_DIR}
Environment=NODE_ENV=production
Environment=HOST=127.0.0.1
Environment=PORT=${APP_PORT}
Environment=COXER_VAULT_DIR=${VAULT_DIR}
${PROXY_LINE}
ExecStart=${NODE_BIN} ${APP_DIR}/server.js
Restart=always
RestartSec=3
NoNewPrivileges=yes
PrivateTmp=yes

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable coxerhub.service
# restart (а не enable --now): чтобы при повторном запуске подхватился новый код
systemctl restart coxerhub.service

# ───────────────────────── Basic Auth (защита: .maFile = доступ к Steam Guard) ─────────────────────────
AUTH_NOTE=""
if [ "$SETUP_AUTH" = "yes" ]; then
  if [ -n "$AUTH_PASS" ]; then
    htpasswd -bc "$HTPASSWD" "$AUTH_USER" "$AUTH_PASS" >/dev/null
    AUTH_NOTE="задан вручную"
  elif [ -f "$HTPASSWD" ]; then
    info "Basic Auth: используется существующий $HTPASSWD (пароль не меняю)"
    AUTH_NOTE="прежний (из $HTPASSWD)"
  else
    AUTH_PASS="$(openssl rand -base64 12)"
    htpasswd -bc "$HTPASSWD" "$AUTH_USER" "$AUTH_PASS" >/dev/null
    AUTH_NOTE="сгенерирован"
  fi
  chown root:www-data "$HTPASSWD"; chmod 640 "$HTPASSWD"
else
  warn "SETUP_AUTH=no — сайт открыт БЕЗ авторизации. Любой по адресу увидит коды и сможет скачать .maFile/снять Guard!"
fi

# ───────────────────────── nginx vhost ─────────────────────────
AUTH_BLOCK=""
[ "$SETUP_AUTH" = "yes" ] && AUTH_BLOCK="auth_basic \"coxerhub\"; auth_basic_user_file ${HTPASSWD};"

log "nginx vhost (server_name: $SERVER_NAME)"
cat > /etc/nginx/sites-available/coxerhub.conf <<NGINX
server {
    listen 80;
    listen [::]:80;
    server_name ${SERVER_NAME};

    client_max_body_size 5m;       # импорт .maFile (express.json limit 5mb)
    gzip on;
    gzip_types text/plain text/css application/json application/javascript image/svg+xml;

    location / {
        ${AUTH_BLOCK}
        proxy_pass http://127.0.0.1:${APP_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 65s;
    }
}
NGINX
ln -sf /etc/nginx/sites-available/coxerhub.conf /etc/nginx/sites-enabled/coxerhub.conf
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl enable nginx
systemctl reload nginx

# ───────────────────────── ufw (SSH открывается ДО enable!) ─────────────────────────
if [ "$SETUP_UFW" = "yes" ] && have ufw; then
  log "Фаервол ufw (SSH → web → enable)"
  ufw allow OpenSSH    >/dev/null 2>&1 || ufw allow 22/tcp >/dev/null 2>&1 || true
  ufw allow 'Nginx Full' >/dev/null 2>&1 || { ufw allow 80/tcp; ufw allow 443/tcp; } >/dev/null 2>&1 || true
  ufw --force enable   >/dev/null 2>&1 || true
fi

# ───────────────────────── TLS (Let's Encrypt) ─────────────────────────
if [ "$SETUP_TLS" = "yes" ]; then
  [ -n "$DOMAIN" ] || die "SETUP_TLS=yes требует DOMAIN"
  log "Выпуск сертификата Let's Encrypt для $DOMAIN"
  command -v snap >/dev/null 2>&1 || apt_install snapd
  snap install core >/dev/null 2>&1 || true
  snap refresh core >/dev/null 2>&1 || true
  if snap install --classic certbot >/dev/null 2>&1; then
    ln -sf /snap/bin/certbot /usr/bin/certbot
  else
    apt_install certbot python3-certbot-nginx
  fi
  if printf '%s' "${TLS_EMAIL}" | grep -Eq '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'; then
    EMAIL_ARG=(-m "$TLS_EMAIL")
  else
    [ -n "$TLS_EMAIL" ] && warn "TLS_EMAIL='${TLS_EMAIL}' невалиден — регистрирую сертификат без email"
    EMAIL_ARG=(--register-unsafely-without-email)
  fi
  certbot --nginx -d "$DOMAIN" -d "www.$DOMAIN" --non-interactive --agree-tos "${EMAIL_ARG[@]}" --redirect \
    || certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos "${EMAIL_ARG[@]}" --redirect \
    || warn "certbot не справился (проверьте A-запись ${DOMAIN} и открытый порт 80). Сайт пока по http."
fi

# ───────────────────────── статус ─────────────────────────
sleep 2
echo
log "Готово. Статус сервисов:"
for s in coxerhub nginx; do
  st="$(systemctl is-active "$s" 2>/dev/null || true)"
  if [ "$st" = "active" ]; then echo "   ${G}●${N} $s"; else echo "   ${R}●${N} $s ($st)"; fi
done
echo
echo "${B}Сайт:${N}           ${SITE_URL}"
echo "${B}Приложение:${N}     127.0.0.1:${APP_PORT}  (наружу только через nginx)"
echo "${B}.maFile:${N}        ${VAULT_DIR}"
echo "${B}Логи:${N}           journalctl -u coxerhub -f"
if [ "$SETUP_AUTH" = "yes" ]; then
  echo
  echo "${B}Доступ (Basic Auth):${N}  логин ${AUTH_USER}"
  if [ -n "${AUTH_PASS}" ]; then
    echo "                       пароль ${B}${AUTH_PASS}${N}  (${AUTH_NOTE})"
  else
    echo "                       пароль ${AUTH_NOTE}"
  fi
  echo "   сменить пароль:  sudo htpasswd ${HTPASSWD} ${AUTH_USER}"
fi
echo
[ -z "$DOMAIN" ] && echo "${Y}HTTPS:${N}  привяжите домен и перезапустите:  sudo DOMAIN=ваш.домен SETUP_TLS=yes TLS_EMAIL=вы@почта bash deploy.sh"
echo "${Y}Обновить код:${N}  git pull → sudo bash deploy.sh  (.maFile в ${VAULT_DIR} не пострадают)"
