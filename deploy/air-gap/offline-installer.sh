#!/bin/bash
#
# Vorion Air-Gap Offline Installer
#
# This script installs Vorion in an air-gapped environment from a pre-built bundle.
# It handles:
# - Loading Docker images from tarballs
# - Database initialization
# - Network configuration
# - Certificate setup
# - Service startup
#
# Usage: sudo ./offline-installer.sh [options]
#

set -euo pipefail

# ============================================================================
# Configuration
# ============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUNDLE_DIR="$(dirname "$SCRIPT_DIR")"
INSTALL_DIR="${INSTALL_DIR:-/opt/vorion}"
DATA_DIR="${DATA_DIR:-/var/lib/vorion}"
LOG_DIR="${LOG_DIR:-/var/log/vorion}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/vorion}"
CONFIG_DIR="${CONFIG_DIR:-$INSTALL_DIR/config}"
CERTS_DIR="${CERTS_DIR:-$INSTALL_DIR/certs}"

# Default values
HOSTNAME="${HOSTNAME:-vorion.local}"
HTTP_PORT="${HTTP_PORT:-80}"
HTTPS_PORT="${HTTPS_PORT:-443}"
SKIP_CERT_GENERATION="${SKIP_CERT_GENERATION:-false}"
SKIP_DB_INIT="${SKIP_DB_INIT:-false}"
INTERACTIVE="${INTERACTIVE:-true}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# ============================================================================
# Utility Functions
# ============================================================================

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[OK]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1" >&2
}

log_step() {
    echo ""
    echo -e "${BLUE}========================================${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}========================================${NC}"
}

confirm() {
    if [ "$INTERACTIVE" = "false" ]; then
        return 0
    fi

    local prompt="$1 [y/N] "
    read -r -p "$prompt" response
    case "$response" in
        [yY][eE][sS]|[yY])
            return 0
            ;;
        *)
            return 1
            ;;
    esac
}

generate_password() {
    local length="${1:-32}"
    openssl rand -base64 "$length" | tr -dc 'a-zA-Z0-9' | head -c "$length"
}

check_root() {
    if [ "$EUID" -ne 0 ]; then
        log_error "This script must be run as root"
        exit 1
    fi
}

# ============================================================================
# Prerequisite Checks
# ============================================================================

check_prerequisites() {
    log_step "Checking Prerequisites"

    local errors=0

    # Check Docker
    if command -v docker &> /dev/null; then
        local docker_version=$(docker --version | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
        log_success "Docker installed: $docker_version"
    else
        log_error "Docker is not installed"
        errors=$((errors + 1))
    fi

    # Check Docker Compose
    if docker compose version &> /dev/null; then
        local compose_version=$(docker compose version --short 2>/dev/null || echo "unknown")
        log_success "Docker Compose installed: $compose_version"
    elif command -v docker-compose &> /dev/null; then
        local compose_version=$(docker-compose --version | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
        log_success "Docker Compose (standalone) installed: $compose_version"
    else
        log_error "Docker Compose is not installed"
        errors=$((errors + 1))
    fi

    # Check OpenSSL
    if command -v openssl &> /dev/null; then
        local openssl_version=$(openssl version | awk '{print $2}')
        log_success "OpenSSL installed: $openssl_version"
    else
        log_error "OpenSSL is not installed"
        errors=$((errors + 1))
    fi

    # Check available disk space
    local required_space=10  # GB
    local available_space=$(df -BG "$INSTALL_DIR" 2>/dev/null | tail -1 | awk '{print $4}' | tr -d 'G' || echo "0")

    if [ -z "$available_space" ] || [ "$available_space" = "0" ]; then
        available_space=$(df -BG / | tail -1 | awk '{print $4}' | tr -d 'G')
    fi

    if [ "$available_space" -ge "$required_space" ]; then
        log_success "Available disk space: ${available_space}GB (${required_space}GB required)"
    else
        log_error "Insufficient disk space: ${available_space}GB available, ${required_space}GB required"
        errors=$((errors + 1))
    fi

    # Check available memory
    local required_memory=4  # GB
    local available_memory=$(free -g | awk '/^Mem:/{print $2}')

    if [ "$available_memory" -ge "$required_memory" ]; then
        log_success "Available memory: ${available_memory}GB (${required_memory}GB required)"
    else
        log_warn "Low memory: ${available_memory}GB available, ${required_memory}GB recommended"
    fi

    # Check bundle files
    if [ -f "$BUNDLE_DIR/manifest.json" ]; then
        log_success "Bundle manifest found"
    else
        log_error "Bundle manifest not found at $BUNDLE_DIR/manifest.json"
        errors=$((errors + 1))
    fi

    if [ -d "$BUNDLE_DIR/docker-images" ]; then
        log_success "Docker images directory found"
    else
        log_error "Docker images directory not found"
        errors=$((errors + 1))
    fi

    if [ $errors -gt 0 ]; then
        log_error "Prerequisites check failed with $errors error(s)"
        exit 1
    fi

    log_success "All prerequisites satisfied"
}

# ============================================================================
# Installation Steps
# ============================================================================

create_directories() {
    log_step "Creating Directory Structure"

    mkdir -p "$INSTALL_DIR"
    mkdir -p "$DATA_DIR"
    mkdir -p "$LOG_DIR"
    mkdir -p "$BACKUP_DIR"
    mkdir -p "$CONFIG_DIR"
    mkdir -p "$CERTS_DIR"
    mkdir -p "$INSTALL_DIR/database"

    # Set permissions
    chmod 750 "$INSTALL_DIR"
    chmod 750 "$DATA_DIR"
    chmod 750 "$LOG_DIR"
    chmod 750 "$BACKUP_DIR"
    chmod 700 "$CERTS_DIR"

    log_success "Directories created"
}

load_docker_images() {
    log_step "Loading Docker Images"

    local images_dir="$BUNDLE_DIR/docker-images"
    local total_images=$(find "$images_dir" -name "*.tar" | wc -l)
    local loaded=0
    local failed=0

    log_info "Found $total_images image(s) to load"

    for image_file in "$images_dir"/*.tar; do
        if [ -f "$image_file" ]; then
            local filename=$(basename "$image_file")
            log_info "Loading: $filename"

            if docker load -i "$image_file" 2>&1; then
                loaded=$((loaded + 1))
                log_success "Loaded: $filename"
            else
                failed=$((failed + 1))
                log_error "Failed to load: $filename"
            fi
        fi
    done

    log_info "Loaded $loaded of $total_images images"

    if [ $failed -gt 0 ]; then
        log_warn "$failed image(s) failed to load"
    fi

    # List loaded images
    log_info "Verifying loaded images:"
    docker images --format "table {{.Repository}}\t{{.Tag}}\t{{.Size}}" | grep -E "vorion|postgres|redis|nginx|minio|prom|grafana" || true
}

copy_configuration() {
    log_step "Copying Configuration Files"

    # Copy configuration templates
    if [ -d "$BUNDLE_DIR/config" ]; then
        cp -r "$BUNDLE_DIR/config/"* "$CONFIG_DIR/" 2>/dev/null || true
        log_success "Configuration templates copied"
    fi

    # Copy database files
    if [ -d "$BUNDLE_DIR/database" ]; then
        cp -r "$BUNDLE_DIR/database/"* "$INSTALL_DIR/database/" 2>/dev/null || true
        log_success "Database schemas copied"
    fi

    # Copy scripts
    if [ -d "$BUNDLE_DIR/scripts" ]; then
        cp -r "$BUNDLE_DIR/scripts/"* "$INSTALL_DIR/" 2>/dev/null || true
        chmod +x "$INSTALL_DIR/"*.sh 2>/dev/null || true
        log_success "Scripts copied"
    fi

    # Copy certificate tools
    if [ -d "$BUNDLE_DIR/certificates" ]; then
        cp -r "$BUNDLE_DIR/certificates/"* "$CERTS_DIR/" 2>/dev/null || true
        chmod +x "$CERTS_DIR/"*.sh 2>/dev/null || true
        log_success "Certificate tools copied"
    fi

    # Copy documentation
    if [ -d "$BUNDLE_DIR/docs" ]; then
        cp -r "$BUNDLE_DIR/docs" "$INSTALL_DIR/" 2>/dev/null || true
        log_success "Documentation copied"
    fi
}

setup_environment() {
    log_step "Setting Up Environment"

    local env_file="$INSTALL_DIR/.env"
    local env_template="$CONFIG_DIR/.env.airgap.template"

    if [ -f "$env_file" ]; then
        log_warn "Environment file already exists at $env_file"
        if confirm "Overwrite existing configuration?"; then
            cp "$env_file" "$env_file.backup.$(date +%Y%m%d_%H%M%S)"
        else
            log_info "Keeping existing configuration"
            return
        fi
    fi

    # Generate secure passwords
    local postgres_password=$(generate_password 32)
    local redis_password=$(generate_password 32)
    local jwt_secret=$(generate_password 64)
    local session_secret=$(generate_password 32)

    # Create environment file from template
    if [ -f "$env_template" ]; then
        cp "$env_template" "$env_file"
    else
        # Create minimal environment file
        cat > "$env_file" << EOF
# Vorion Air-Gap Environment Configuration
# Generated: $(date -Iseconds)

# Database
POSTGRES_USER=vorion
POSTGRES_PASSWORD=$postgres_password
POSTGRES_DB=vorion

# Redis
REDIS_PASSWORD=$redis_password

# Security
JWT_SECRET=$jwt_secret
SESSION_SECRET=$session_secret

# Network
HTTP_PORT=$HTTP_PORT
HTTPS_PORT=$HTTPS_PORT
CORS_ORIGIN=https://$HOSTNAME
INTERNAL_HOSTNAME=$HOSTNAME

# TLS
SSL_CERT_PATH=./certs/server.crt
SSL_KEY_PATH=./certs/server.key
SSL_CA_PATH=./certs/ca.crt

# Logging
LOG_LEVEL=info
LOG_FORMAT=json

# Air-Gap Settings
DISABLE_TELEMETRY=true
DISABLE_UPDATE_CHECK=true
DISABLE_EXTERNAL_INTEGRATIONS=true
EOF
    fi

    # Update passwords in env file
    sed -i "s/CHANGE_THIS_SECURE_PASSWORD/$postgres_password/g" "$env_file" 2>/dev/null || true
    sed -i "s/CHANGE_THIS_SECURE_SECRET/$jwt_secret/g" "$env_file" 2>/dev/null || true

    chmod 600 "$env_file"

    log_success "Environment configured"
    log_warn "IMPORTANT: Review and update $env_file before starting services"
}

setup_certificates() {
    log_step "Setting Up Certificates"

    if [ "$SKIP_CERT_GENERATION" = "true" ]; then
        log_info "Certificate generation skipped"
        return
    fi

    local ca_dir="$CERTS_DIR/ca"
    mkdir -p "$ca_dir"

    # Check for existing certificates
    if [ -f "$CERTS_DIR/server.crt" ] && [ -f "$CERTS_DIR/server.key" ]; then
        log_warn "Certificates already exist"
        if ! confirm "Regenerate certificates?"; then
            log_info "Keeping existing certificates"
            return
        fi
    fi

    # Generate CA if it doesn't exist
    if [ ! -f "$ca_dir/ca.crt" ]; then
        log_info "Generating internal Certificate Authority..."

        openssl genrsa -out "$ca_dir/ca.key" 4096

        openssl req -x509 -new -nodes \
            -key "$ca_dir/ca.key" \
            -sha256 -days 3650 \
            -out "$ca_dir/ca.crt" \
            -subj "/C=US/ST=State/L=City/O=Organization/OU=IT/CN=Vorion Internal CA"

        chmod 600 "$ca_dir/ca.key"
        log_success "CA certificate generated"
    else
        log_info "Using existing CA certificate"
    fi

    # Generate server certificate
    log_info "Generating server certificate for $HOSTNAME..."

    # Create OpenSSL config with SAN
    cat > "$CERTS_DIR/openssl.cnf" << EOF
[req]
default_bits = 2048
prompt = no
default_md = sha256
distinguished_name = dn
req_extensions = req_ext

[dn]
C = US
ST = State
L = City
O = Organization
OU = IT
CN = $HOSTNAME

[req_ext]
subjectAltName = @alt_names

[alt_names]
DNS.1 = $HOSTNAME
DNS.2 = *.$HOSTNAME
DNS.3 = localhost
IP.1 = 127.0.0.1
EOF

    # Generate server key and CSR
    openssl genrsa -out "$CERTS_DIR/server.key" 2048

    openssl req -new \
        -key "$CERTS_DIR/server.key" \
        -out "$CERTS_DIR/server.csr" \
        -config "$CERTS_DIR/openssl.cnf"

    # Sign with CA
    openssl x509 -req \
        -in "$CERTS_DIR/server.csr" \
        -CA "$ca_dir/ca.crt" \
        -CAkey "$ca_dir/ca.key" \
        -CAcreateserial \
        -out "$CERTS_DIR/server.crt" \
        -days 365 \
        -sha256 \
        -extfile "$CERTS_DIR/openssl.cnf" \
        -extensions req_ext

    # Create full chain
    cat "$CERTS_DIR/server.crt" "$ca_dir/ca.crt" > "$CERTS_DIR/fullchain.crt"

    # Copy CA cert for clients
    cp "$ca_dir/ca.crt" "$CERTS_DIR/ca.crt"

    # Cleanup
    rm -f "$CERTS_DIR/server.csr" "$CERTS_DIR/openssl.cnf"

    # Set permissions
    chmod 600 "$CERTS_DIR/server.key"
    chmod 644 "$CERTS_DIR/server.crt"
    chmod 644 "$CERTS_DIR/ca.crt"

    log_success "Server certificate generated"
    log_info "CA certificate: $ca_dir/ca.crt"
    log_info "Server certificate: $CERTS_DIR/server.crt"
    log_warn "Distribute $CERTS_DIR/ca.crt to client machines for trust"
}

setup_docker_compose() {
    log_step "Setting Up Docker Compose"

    local compose_file="$INSTALL_DIR/docker-compose.yml"
    local compose_template="$CONFIG_DIR/docker-compose.airgap.yml"

    if [ -f "$compose_template" ]; then
        cp "$compose_template" "$compose_file"
    else
        log_error "Docker Compose template not found"
        exit 1
    fi

    # Copy nginx config
    if [ -f "$CONFIG_DIR/nginx.airgap.conf" ]; then
        cp "$CONFIG_DIR/nginx.airgap.conf" "$INSTALL_DIR/nginx.conf"
    fi

    log_success "Docker Compose configured"
}

initialize_database() {
    log_step "Initializing Database"

    if [ "$SKIP_DB_INIT" = "true" ]; then
        log_info "Database initialization skipped"
        return
    fi

    # Source environment
    if [ -f "$INSTALL_DIR/.env" ]; then
        set -a
        source "$INSTALL_DIR/.env"
        set +a
    fi

    # Start only PostgreSQL
    log_info "Starting PostgreSQL container..."
    cd "$INSTALL_DIR"
    docker compose up -d postgres

    # Wait for PostgreSQL to be ready
    log_info "Waiting for PostgreSQL to be ready..."
    local retries=30
    while [ $retries -gt 0 ]; do
        if docker compose exec -T postgres pg_isready -U "${POSTGRES_USER:-vorion}" &> /dev/null; then
            log_success "PostgreSQL is ready"
            break
        fi
        retries=$((retries - 1))
        sleep 2
    done

    if [ $retries -eq 0 ]; then
        log_error "PostgreSQL failed to start"
        exit 1
    fi

    # Run initialization scripts
    if [ -f "$INSTALL_DIR/database/init.sql" ]; then
        log_info "Running database initialization..."
        docker compose exec -T postgres psql -U "${POSTGRES_USER:-vorion}" -d "${POSTGRES_DB:-vorion}" < "$INSTALL_DIR/database/init.sql"
        log_success "Database initialized"
    fi

    # Run seed data (optional)
    if [ -f "$INSTALL_DIR/database/seed.sql" ]; then
        if confirm "Load seed data (creates default admin user)?"; then
            docker compose exec -T postgres psql -U "${POSTGRES_USER:-vorion}" -d "${POSTGRES_DB:-vorion}" < "$INSTALL_DIR/database/seed.sql"
            log_success "Seed data loaded"
            log_warn "Default admin: admin@localhost / changeme123! - CHANGE IMMEDIATELY!"
        fi
    fi

    # Stop PostgreSQL (will be started with full stack)
    docker compose down
}

configure_networking() {
    log_step "Configuring Network"

    # Add hostname to /etc/hosts if not present
    if ! grep -q "$HOSTNAME" /etc/hosts; then
        log_info "Adding $HOSTNAME to /etc/hosts"
        echo "127.0.0.1    $HOSTNAME" >> /etc/hosts
        log_success "Hostname added to /etc/hosts"
    else
        log_info "$HOSTNAME already in /etc/hosts"
    fi

    # Configure firewall if available
    if command -v firewall-cmd &> /dev/null; then
        log_info "Configuring firewalld..."
        firewall-cmd --permanent --add-port="$HTTP_PORT/tcp" 2>/dev/null || true
        firewall-cmd --permanent --add-port="$HTTPS_PORT/tcp" 2>/dev/null || true
        firewall-cmd --reload 2>/dev/null || true
        log_success "Firewall configured"
    elif command -v ufw &> /dev/null; then
        log_info "Configuring ufw..."
        ufw allow "$HTTP_PORT/tcp" 2>/dev/null || true
        ufw allow "$HTTPS_PORT/tcp" 2>/dev/null || true
        log_success "Firewall configured"
    else
        log_info "No firewall detected, skipping configuration"
    fi
}

start_services() {
    log_step "Starting Services"

    cd "$INSTALL_DIR"

    # Load environment
    if [ -f "$INSTALL_DIR/.env" ]; then
        set -a
        source "$INSTALL_DIR/.env"
        set +a
    fi

    log_info "Starting all services..."
    docker compose up -d

    # Wait for services to be healthy
    log_info "Waiting for services to become healthy..."
    sleep 10

    # Check service status
    log_info "Service status:"
    docker compose ps

    # Verify health
    local services=("api" "web" "postgres" "redis" "nginx")
    local all_healthy=true

    for service in "${services[@]}"; do
        local container="vorion-$service"
        local status=$(docker inspect --format='{{.State.Status}}' "$container" 2>/dev/null || echo "not found")

        if [ "$status" = "running" ]; then
            log_success "$service: running"
        else
            log_error "$service: $status"
            all_healthy=false
        fi
    done

    if [ "$all_healthy" = true ]; then
        log_success "All services started successfully"
    else
        log_warn "Some services may not be running correctly"
        log_info "Check logs with: docker compose logs"
    fi
}

create_systemd_service() {
    log_step "Creating Systemd Service"

    local service_file="/etc/systemd/system/vorion.service"

    cat > "$service_file" << EOF
[Unit]
Description=Vorion Application Stack
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=$INSTALL_DIR
ExecStart=/usr/bin/docker compose up -d
ExecStop=/usr/bin/docker compose down
TimeoutStartSec=300

[Install]
WantedBy=multi-user.target
EOF

    systemctl daemon-reload
    systemctl enable vorion.service

    log_success "Systemd service created and enabled"
    log_info "Service commands:"
    log_info "  Start:   systemctl start vorion"
    log_info "  Stop:    systemctl stop vorion"
    log_info "  Status:  systemctl status vorion"
}

print_summary() {
    log_step "Installation Complete"

    echo ""
    echo "=========================================="
    echo "          INSTALLATION SUMMARY"
    echo "=========================================="
    echo ""
    echo "Installation Directory: $INSTALL_DIR"
    echo "Data Directory:         $DATA_DIR"
    echo "Log Directory:          $LOG_DIR"
    echo "Certificates:           $CERTS_DIR"
    echo ""
    echo "Access URL:             https://$HOSTNAME:$HTTPS_PORT"
    echo ""
    echo "Important Files:"
    echo "  Environment:    $INSTALL_DIR/.env"
    echo "  Docker Compose: $INSTALL_DIR/docker-compose.yml"
    echo "  CA Certificate: $CERTS_DIR/ca.crt"
    echo ""
    echo "Commands:"
    echo "  Start services:  systemctl start vorion"
    echo "  Stop services:   systemctl stop vorion"
    echo "  View logs:       cd $INSTALL_DIR && docker compose logs -f"
    echo "  Health check:    $INSTALL_DIR/health-check.sh"
    echo "  Backup:          $INSTALL_DIR/backup.sh"
    echo ""
    echo "=========================================="
    echo ""
    log_warn "SECURITY REMINDERS:"
    echo "  1. Change default admin password immediately"
    echo "  2. Review and secure $INSTALL_DIR/.env"
    echo "  3. Distribute CA certificate to clients: $CERTS_DIR/ca.crt"
    echo "  4. Configure regular backups"
    echo ""
    echo "Documentation: $INSTALL_DIR/docs/AIR-GAP-DEPLOYMENT.md"
    echo ""
}

# ============================================================================
# Main
# ============================================================================

usage() {
    cat << EOF
Vorion Air-Gap Offline Installer

Usage: $0 [options]

Options:
    -h, --help              Show this help message
    -y, --yes               Non-interactive mode (accept all defaults)
    -d, --dir <path>        Installation directory (default: /opt/vorion)
    -n, --hostname <name>   Server hostname (default: vorion.local)
    --skip-certs            Skip certificate generation
    --skip-db-init          Skip database initialization
    --http-port <port>      HTTP port (default: 80)
    --https-port <port>     HTTPS port (default: 443)

Examples:
    sudo $0
    sudo $0 -y -n myserver.local
    sudo $0 --dir /apps/vorion --skip-certs

EOF
}

main() {
    # Parse arguments
    while [[ $# -gt 0 ]]; do
        case $1 in
            -h|--help)
                usage
                exit 0
                ;;
            -y|--yes)
                INTERACTIVE="false"
                shift
                ;;
            -d|--dir)
                INSTALL_DIR="$2"
                shift 2
                ;;
            -n|--hostname)
                HOSTNAME="$2"
                shift 2
                ;;
            --skip-certs)
                SKIP_CERT_GENERATION="true"
                shift
                ;;
            --skip-db-init)
                SKIP_DB_INIT="true"
                shift
                ;;
            --http-port)
                HTTP_PORT="$2"
                shift 2
                ;;
            --https-port)
                HTTPS_PORT="$2"
                shift 2
                ;;
            *)
                log_error "Unknown option: $1"
                usage
                exit 1
                ;;
        esac
    done

    # Update dependent paths
    CONFIG_DIR="$INSTALL_DIR/config"
    CERTS_DIR="$INSTALL_DIR/certs"

    echo ""
    echo "╔════════════════════════════════════════════════════════════╗"
    echo "║           VORION AIR-GAP OFFLINE INSTALLER                 ║"
    echo "╚════════════════════════════════════════════════════════════╝"
    echo ""

    check_root
    check_prerequisites

    if [ "$INTERACTIVE" = "true" ]; then
        echo ""
        log_info "Installation will proceed with the following settings:"
        echo "  Install Directory: $INSTALL_DIR"
        echo "  Hostname:          $HOSTNAME"
        echo "  HTTP Port:         $HTTP_PORT"
        echo "  HTTPS Port:        $HTTPS_PORT"
        echo ""

        if ! confirm "Proceed with installation?"; then
            log_info "Installation cancelled"
            exit 0
        fi
    fi

    create_directories
    load_docker_images
    copy_configuration
    setup_environment
    setup_certificates
    setup_docker_compose
    initialize_database
    configure_networking
    start_services
    create_systemd_service
    print_summary
}

main "$@"
