#!/bin/bash
#
# Vorion Certificate Generation Script
#
# This script generates a complete PKI infrastructure for air-gapped deployments:
# - Internal Certificate Authority (CA)
# - Server certificates with SAN support
# - Client certificates for mutual TLS (optional)
#
# Usage: ./generate-certs.sh [options]
#

set -euo pipefail

# =============================================================================
# Configuration
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUTPUT_DIR="${OUTPUT_DIR:-$SCRIPT_DIR/../certs}"
CA_DIR="${CA_DIR:-$OUTPUT_DIR/ca}"

# Certificate settings
CA_DAYS="${CA_DAYS:-3650}"           # 10 years
SERVER_DAYS="${SERVER_DAYS:-365}"     # 1 year
CLIENT_DAYS="${CLIENT_DAYS:-365}"     # 1 year
KEY_SIZE="${KEY_SIZE:-4096}"
SERVER_KEY_SIZE="${SERVER_KEY_SIZE:-2048}"

# Default values
HOSTNAME="${HOSTNAME:-vorion.local}"
ORGANIZATION="${ORGANIZATION:-Vorion}"
ORGANIZATIONAL_UNIT="${ORGANIZATIONAL_UNIT:-IT Security}"
COUNTRY="${COUNTRY:-US}"
STATE="${STATE:-State}"
CITY="${CITY:-City}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# =============================================================================
# Utility Functions
# =============================================================================

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

usage() {
    cat << EOF
Vorion Certificate Generation Script

Usage: $0 [options]

Options:
    -h, --help              Show this help message
    -o, --output <dir>      Output directory (default: ../certs)
    -n, --hostname <name>   Server hostname (default: vorion.local)
    --org <name>            Organization name
    --country <code>        Country code (default: US)
    --ca-only               Only generate CA certificate
    --server-only           Only generate server certificate (requires existing CA)
    --client <name>         Generate client certificate with given name
    --renew-server          Renew server certificate using existing CA

Examples:
    $0
    $0 -n myserver.internal.local
    $0 --client admin
    $0 --renew-server

EOF
}

# =============================================================================
# Certificate Generation Functions
# =============================================================================

generate_ca() {
    log_info "Generating Certificate Authority..."

    mkdir -p "$CA_DIR"

    # Generate CA private key
    if [ ! -f "$CA_DIR/ca.key" ]; then
        log_info "  Generating CA private key..."
        openssl genrsa -out "$CA_DIR/ca.key" "$KEY_SIZE"
        chmod 600 "$CA_DIR/ca.key"
    else
        log_warn "  CA private key already exists, skipping..."
    fi

    # Generate CA certificate
    if [ ! -f "$CA_DIR/ca.crt" ]; then
        log_info "  Generating CA certificate..."
        openssl req -x509 -new -nodes \
            -key "$CA_DIR/ca.key" \
            -sha256 -days "$CA_DAYS" \
            -out "$CA_DIR/ca.crt" \
            -subj "/C=$COUNTRY/ST=$STATE/L=$CITY/O=$ORGANIZATION/OU=$ORGANIZATIONAL_UNIT/CN=$ORGANIZATION Internal CA"
    else
        log_warn "  CA certificate already exists, skipping..."
    fi

    # Create CA serial file
    if [ ! -f "$CA_DIR/ca.srl" ]; then
        echo "1000" > "$CA_DIR/ca.srl"
    fi

    # Create index file for certificate tracking
    if [ ! -f "$CA_DIR/index.txt" ]; then
        touch "$CA_DIR/index.txt"
    fi

    log_success "Certificate Authority generated"
    log_info "  CA Certificate: $CA_DIR/ca.crt"
    log_info "  CA Private Key: $CA_DIR/ca.key (KEEP SECURE!)"
}

generate_server_cert() {
    local hostname="${1:-$HOSTNAME}"
    local output_name="${2:-server}"

    log_info "Generating server certificate for: $hostname"

    mkdir -p "$OUTPUT_DIR"

    # Check for CA
    if [ ! -f "$CA_DIR/ca.key" ] || [ ! -f "$CA_DIR/ca.crt" ]; then
        log_error "CA not found. Run with --ca-only first or generate full PKI."
        exit 1
    fi

    # Create OpenSSL config with SAN
    local config_file=$(mktemp)
    cat > "$config_file" << EOF
[req]
default_bits = $SERVER_KEY_SIZE
prompt = no
default_md = sha256
distinguished_name = dn
req_extensions = req_ext
x509_extensions = v3_ext

[dn]
C = $COUNTRY
ST = $STATE
L = $CITY
O = $ORGANIZATION
OU = $ORGANIZATIONAL_UNIT
CN = $hostname

[req_ext]
subjectAltName = @alt_names

[v3_ext]
basicConstraints = CA:FALSE
keyUsage = nonRepudiation, digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = @alt_names

[alt_names]
DNS.1 = $hostname
DNS.2 = *.$hostname
DNS.3 = localhost
DNS.4 = api.$hostname
DNS.5 = web.$hostname
IP.1 = 127.0.0.1
IP.2 = 172.28.0.2
IP.3 = 172.28.0.10
IP.4 = 172.28.0.11
EOF

    # Generate server private key
    log_info "  Generating server private key..."
    openssl genrsa -out "$OUTPUT_DIR/$output_name.key" "$SERVER_KEY_SIZE"
    chmod 600 "$OUTPUT_DIR/$output_name.key"

    # Generate CSR
    log_info "  Generating certificate signing request..."
    openssl req -new \
        -key "$OUTPUT_DIR/$output_name.key" \
        -out "$OUTPUT_DIR/$output_name.csr" \
        -config "$config_file"

    # Sign with CA
    log_info "  Signing certificate with CA..."
    openssl x509 -req \
        -in "$OUTPUT_DIR/$output_name.csr" \
        -CA "$CA_DIR/ca.crt" \
        -CAkey "$CA_DIR/ca.key" \
        -CAserial "$CA_DIR/ca.srl" \
        -out "$OUTPUT_DIR/$output_name.crt" \
        -days "$SERVER_DAYS" \
        -sha256 \
        -extfile "$config_file" \
        -extensions v3_ext

    # Create full chain certificate
    log_info "  Creating certificate chain..."
    cat "$OUTPUT_DIR/$output_name.crt" "$CA_DIR/ca.crt" > "$OUTPUT_DIR/$output_name.fullchain.crt"

    # Copy CA certificate for distribution
    cp "$CA_DIR/ca.crt" "$OUTPUT_DIR/ca.crt"

    # Cleanup
    rm -f "$OUTPUT_DIR/$output_name.csr" "$config_file"

    log_success "Server certificate generated"
    log_info "  Certificate:  $OUTPUT_DIR/$output_name.crt"
    log_info "  Private Key:  $OUTPUT_DIR/$output_name.key"
    log_info "  Full Chain:   $OUTPUT_DIR/$output_name.fullchain.crt"
    log_info "  CA Cert:      $OUTPUT_DIR/ca.crt"

    # Verify certificate
    log_info "  Verifying certificate..."
    openssl verify -CAfile "$CA_DIR/ca.crt" "$OUTPUT_DIR/$output_name.crt"
}

generate_client_cert() {
    local client_name="$1"

    log_info "Generating client certificate for: $client_name"

    # Check for CA
    if [ ! -f "$CA_DIR/ca.key" ] || [ ! -f "$CA_DIR/ca.crt" ]; then
        log_error "CA not found. Generate CA first."
        exit 1
    fi

    local client_dir="$OUTPUT_DIR/clients"
    mkdir -p "$client_dir"

    # Create OpenSSL config for client cert
    local config_file=$(mktemp)
    cat > "$config_file" << EOF
[req]
default_bits = $SERVER_KEY_SIZE
prompt = no
default_md = sha256
distinguished_name = dn

[dn]
C = $COUNTRY
ST = $STATE
L = $CITY
O = $ORGANIZATION
OU = Users
CN = $client_name

[v3_ext]
basicConstraints = CA:FALSE
keyUsage = nonRepudiation, digitalSignature, keyEncipherment
extendedKeyUsage = clientAuth
EOF

    # Generate client private key
    log_info "  Generating client private key..."
    openssl genrsa -out "$client_dir/$client_name.key" "$SERVER_KEY_SIZE"
    chmod 600 "$client_dir/$client_name.key"

    # Generate CSR
    log_info "  Generating certificate signing request..."
    openssl req -new \
        -key "$client_dir/$client_name.key" \
        -out "$client_dir/$client_name.csr" \
        -config "$config_file"

    # Sign with CA
    log_info "  Signing certificate with CA..."
    openssl x509 -req \
        -in "$client_dir/$client_name.csr" \
        -CA "$CA_DIR/ca.crt" \
        -CAkey "$CA_DIR/ca.key" \
        -CAserial "$CA_DIR/ca.srl" \
        -out "$client_dir/$client_name.crt" \
        -days "$CLIENT_DAYS" \
        -sha256 \
        -extfile "$config_file" \
        -extensions v3_ext

    # Create PKCS12 bundle for browser import
    log_info "  Creating PKCS12 bundle..."
    local p12_password=$(openssl rand -base64 16)
    openssl pkcs12 -export \
        -out "$client_dir/$client_name.p12" \
        -inkey "$client_dir/$client_name.key" \
        -in "$client_dir/$client_name.crt" \
        -certfile "$CA_DIR/ca.crt" \
        -passout "pass:$p12_password"

    # Save password to file
    echo "$p12_password" > "$client_dir/$client_name.p12.password"
    chmod 600 "$client_dir/$client_name.p12.password"

    # Cleanup
    rm -f "$client_dir/$client_name.csr" "$config_file"

    log_success "Client certificate generated"
    log_info "  Certificate: $client_dir/$client_name.crt"
    log_info "  Private Key: $client_dir/$client_name.key"
    log_info "  PKCS12:      $client_dir/$client_name.p12"
    log_info "  Password:    $client_dir/$client_name.p12.password"
}

verify_certificates() {
    log_info "Verifying certificates..."

    local all_valid=true

    # Verify CA
    if [ -f "$CA_DIR/ca.crt" ]; then
        local ca_expiry=$(openssl x509 -enddate -noout -in "$CA_DIR/ca.crt" | cut -d= -f2)
        log_info "  CA Certificate expires: $ca_expiry"
    else
        log_error "  CA certificate not found"
        all_valid=false
    fi

    # Verify server cert
    if [ -f "$OUTPUT_DIR/server.crt" ]; then
        local server_expiry=$(openssl x509 -enddate -noout -in "$OUTPUT_DIR/server.crt" | cut -d= -f2)
        log_info "  Server certificate expires: $server_expiry"

        # Verify chain
        if openssl verify -CAfile "$CA_DIR/ca.crt" "$OUTPUT_DIR/server.crt" &>/dev/null; then
            log_success "  Server certificate chain valid"
        else
            log_error "  Server certificate chain INVALID"
            all_valid=false
        fi
    else
        log_warn "  Server certificate not found"
    fi

    # List client certs
    if [ -d "$OUTPUT_DIR/clients" ]; then
        for cert in "$OUTPUT_DIR/clients"/*.crt; do
            if [ -f "$cert" ]; then
                local name=$(basename "$cert" .crt)
                local expiry=$(openssl x509 -enddate -noout -in "$cert" | cut -d= -f2)
                log_info "  Client '$name' expires: $expiry"
            fi
        done
    fi

    if [ "$all_valid" = true ]; then
        log_success "All certificates are valid"
    else
        log_error "Some certificates are invalid"
        exit 1
    fi
}

print_distribution_info() {
    echo ""
    echo "=========================================="
    echo "CERTIFICATE DISTRIBUTION INSTRUCTIONS"
    echo "=========================================="
    echo ""
    echo "1. CA Certificate Distribution"
    echo "   Distribute to all client machines: $OUTPUT_DIR/ca.crt"
    echo ""
    echo "   For Linux:"
    echo "     sudo cp $OUTPUT_DIR/ca.crt /usr/local/share/ca-certificates/vorion-ca.crt"
    echo "     sudo update-ca-certificates"
    echo ""
    echo "   For macOS:"
    echo "     sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain $OUTPUT_DIR/ca.crt"
    echo ""
    echo "   For Windows (PowerShell as Admin):"
    echo "     Import-Certificate -FilePath $OUTPUT_DIR/ca.crt -CertStoreLocation Cert:\\LocalMachine\\Root"
    echo ""
    echo "2. Server Certificate"
    echo "   Used by Nginx: $OUTPUT_DIR/server.crt and $OUTPUT_DIR/server.key"
    echo ""
    echo "3. Client Certificates (if generated)"
    echo "   Location: $OUTPUT_DIR/clients/"
    echo "   Import .p12 files into browser/system (password in .password file)"
    echo ""
    echo "=========================================="
}

# =============================================================================
# Main
# =============================================================================

main() {
    local action="full"
    local client_name=""

    # Parse arguments
    while [[ $# -gt 0 ]]; do
        case $1 in
            -h|--help)
                usage
                exit 0
                ;;
            -o|--output)
                OUTPUT_DIR="$2"
                CA_DIR="$OUTPUT_DIR/ca"
                shift 2
                ;;
            -n|--hostname)
                HOSTNAME="$2"
                shift 2
                ;;
            --org)
                ORGANIZATION="$2"
                shift 2
                ;;
            --country)
                COUNTRY="$2"
                shift 2
                ;;
            --ca-only)
                action="ca-only"
                shift
                ;;
            --server-only)
                action="server-only"
                shift
                ;;
            --client)
                action="client"
                client_name="$2"
                shift 2
                ;;
            --renew-server)
                action="renew-server"
                shift
                ;;
            --verify)
                action="verify"
                shift
                ;;
            *)
                log_error "Unknown option: $1"
                usage
                exit 1
                ;;
        esac
    done

    echo ""
    echo "╔════════════════════════════════════════════════════════════╗"
    echo "║         VORION CERTIFICATE GENERATION UTILITY              ║"
    echo "╚════════════════════════════════════════════════════════════╝"
    echo ""
    echo "Output Directory: $OUTPUT_DIR"
    echo "Hostname: $HOSTNAME"
    echo "Organization: $ORGANIZATION"
    echo ""

    case $action in
        full)
            generate_ca
            generate_server_cert "$HOSTNAME"
            verify_certificates
            print_distribution_info
            ;;
        ca-only)
            generate_ca
            ;;
        server-only)
            generate_server_cert "$HOSTNAME"
            verify_certificates
            ;;
        renew-server)
            # Backup old cert
            if [ -f "$OUTPUT_DIR/server.crt" ]; then
                mv "$OUTPUT_DIR/server.crt" "$OUTPUT_DIR/server.crt.old.$(date +%Y%m%d)"
                mv "$OUTPUT_DIR/server.key" "$OUTPUT_DIR/server.key.old.$(date +%Y%m%d)"
            fi
            generate_server_cert "$HOSTNAME"
            verify_certificates
            ;;
        client)
            if [ -z "$client_name" ]; then
                log_error "Client name required"
                exit 1
            fi
            generate_client_cert "$client_name"
            ;;
        verify)
            verify_certificates
            ;;
    esac

    echo ""
    log_success "Certificate generation complete!"
}

main "$@"
