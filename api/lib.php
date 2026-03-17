<?php
declare(strict_types=1);

session_start();

const DB_PATH = __DIR__ . '/../data/app.db';

function ensure_db_dir(): void {
    $dir = dirname(DB_PATH);
    if (!is_dir($dir)) {
        mkdir($dir, 0777, true);
    }
}

function db(): PDO {
    static $pdo = null;
    if ($pdo instanceof PDO) {
        return $pdo;
    }
    ensure_db_dir();
    $pdo = new PDO('sqlite:' . DB_PATH, null, null, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
    $pdo->exec('PRAGMA foreign_keys = ON;');
    $pdo->exec('PRAGMA journal_mode = WAL;');
    return $pdo;
}

function init_db(): void {
    $pdo = db();
    $pdo->exec('CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL,
        username_lower TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT "user",
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        last_login_at TEXT,
        last_login_lat REAL,
        last_login_lng REAL,
        last_login_accuracy REAL,
        last_login_status TEXT
    );');
    $pdo->exec('CREATE TABLE IF NOT EXISTS pins (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        address TEXT NOT NULL,
        name_lower TEXT NOT NULL,
        address_lower TEXT NOT NULL,
        lat REAL NOT NULL,
        lng REAL NOT NULL,
        created_at TEXT NOT NULL,
        created_by INTEGER,
        UNIQUE(name_lower, address_lower)
    );');
    $pdo->exec('CREATE INDEX IF NOT EXISTS idx_pins_created_at ON pins(created_at);');
    $pdo->exec('CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at);');

    $count = (int)$pdo->query('SELECT COUNT(*) FROM users')->fetchColumn();
    if ($count === 0) {
        $username = 'tzuadmin';
        $password = '123456';
        $normalized = normalize_text($username);
        $hash = password_hash($password, PASSWORD_DEFAULT);
        $stmt = $pdo->prepare('INSERT INTO users (username, username_lower, password_hash, role, active, created_at, last_login_status)
            VALUES (:username, :username_lower, :password_hash, :role, :active, :created_at, :last_login_status)');
        $stmt->execute([
            ':username' => $username,
            ':username_lower' => $normalized,
            ':password_hash' => $hash,
            ':role' => 'admin',
            ':active' => 1,
            ':created_at' => date('c'),
            ':last_login_status' => '尚未登入',
        ]);
    }
}

function normalize_text(string $value): string {
    $trimmed = trim($value);
    $normalized = preg_replace('/\s+/', ' ', $trimmed);
    if (function_exists('mb_strtolower')) {
        return mb_strtolower($normalized, 'UTF-8');
    }
    return strtolower($normalized);
}

function json_response(bool $ok, $payload = null, int $status = 200): void {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    if ($ok) {
        echo json_encode(['ok' => true, 'data' => $payload], JSON_UNESCAPED_UNICODE);
        return;
    }
    echo json_encode(['ok' => false, 'error' => $payload], JSON_UNESCAPED_UNICODE);
}

function get_input(): array {
    $raw = file_get_contents('php://input');
    if (!$raw) {
        return [];
    }
    $data = json_decode($raw, true);
    if (!is_array($data)) {
        return [];
    }
    return $data;
}

function get_session_user_id(): ?int {
    if (!isset($_SESSION['user_id'])) {
        return null;
    }
    return (int)$_SESSION['user_id'];
}

function get_user_by_id(int $userId): ?array {
    $stmt = db()->prepare('SELECT * FROM users WHERE id = :id LIMIT 1');
    $stmt->execute([':id' => $userId]);
    $row = $stmt->fetch();
    return $row ?: null;
}

function require_login(): array {
    $userId = get_session_user_id();
    if (!$userId) {
        json_response(false, '請先登入。', 401);
        exit;
    }
    $user = get_user_by_id($userId);
    if (!$user || (int)$user['active'] !== 1) {
        json_response(false, '帳號已停用或不存在。', 403);
        exit;
    }
    return $user;
}

function require_admin(): array {
    $user = require_login();
    if (($user['role'] ?? 'user') !== 'admin') {
        json_response(false, '只有管理員可以操作。', 403);
        exit;
    }
    return $user;
}

function user_to_output(array $row): array {
    return [
        'id' => (int)$row['id'],
        'username' => $row['username'],
        'role' => $row['role'] ?? 'user',
        'active' => ((int)$row['active']) === 1,
        'createdAt' => $row['created_at'],
        'lastLoginAt' => $row['last_login_at'],
        'lastLoginLat' => $row['last_login_lat'],
        'lastLoginLng' => $row['last_login_lng'],
        'lastLoginAccuracy' => $row['last_login_accuracy'],
        'lastLoginStatus' => $row['last_login_status'] ?: '尚未登入',
    ];
}

function pin_to_output(array $row): array {
    return [
        'id' => (int)$row['id'],
        'name' => $row['name'],
        'address' => $row['address'],
        'lat' => (float)$row['lat'],
        'lng' => (float)$row['lng'],
        'createdAt' => $row['created_at'],
    ];
}
