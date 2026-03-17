<?php
declare(strict_types=1);

require_once __DIR__ . '/lib.php';

init_db();

$action = $_GET['action'] ?? '';
$input = get_input();

function to_iso($value): string {
    if (!$value) {
        return date('c');
    }
    $ts = strtotime((string)$value);
    if ($ts === false) {
        return date('c');
    }
    return date('c', $ts);
}

switch ($action) {
    case 'session': {
        $userId = get_session_user_id();
        if (!$userId) {
            json_response(true, ['user' => null]);
            break;
        }
        $user = get_user_by_id($userId);
        if (!$user || (int)$user['active'] !== 1) {
            $_SESSION = [];
            session_destroy();
            json_response(true, ['user' => null]);
            break;
        }
        json_response(true, ['user' => user_to_output($user)]);
        break;
    }

    case 'login': {
        $username = trim((string)($input['username'] ?? ''));
        $password = (string)($input['password'] ?? '');
        $role = (string)($input['role'] ?? 'user');

        if ($username === '' || $password === '') {
            json_response(false, '請輸入帳號與密碼。', 400);
            break;
        }

        $normalized = normalize_text($username);
        $stmt = db()->prepare('SELECT * FROM users WHERE username_lower = :u LIMIT 1');
        $stmt->execute([':u' => $normalized]);
        $user = $stmt->fetch();
        if (!$user || !password_verify($password, $user['password_hash'])) {
            json_response(false, '帳號或密碼錯誤。', 401);
            break;
        }
        if ((int)$user['active'] !== 1) {
            json_response(false, '此帳號已停用，請聯絡管理員。', 403);
            break;
        }
        if (($user['role'] ?? 'user') !== $role) {
            json_response(false, '此帳號身分不符。', 403);
            break;
        }

        session_regenerate_id(true);
        $_SESSION['user_id'] = (int)$user['id'];
        json_response(true, ['user' => user_to_output($user)]);
        break;
    }

    case 'logout': {
        $_SESSION = [];
        session_destroy();
        json_response(true, null);
        break;
    }

    case 'pins:list': {
        require_login();
        $stmt = db()->query('SELECT * FROM pins ORDER BY created_at ASC');
        $rows = $stmt->fetchAll();
        $pins = array_map('pin_to_output', $rows);
        json_response(true, ['pins' => $pins]);
        break;
    }

    case 'pins:add': {
        $user = require_login();
        $name = trim((string)($input['name'] ?? ''));
        $address = trim((string)($input['address'] ?? ''));
        $lat = $input['lat'] ?? null;
        $lng = $input['lng'] ?? null;

        if ($name === '' || $address === '') {
            json_response(false, '請填寫店名與地址。', 400);
            break;
        }
        if (!is_numeric($lat) || !is_numeric($lng)) {
            json_response(false, '座標格式不正確。', 400);
            break;
        }

        $nameLower = normalize_text($name);
        $addressLower = normalize_text($address);
        $createdAt = to_iso($input['createdAt'] ?? null);

        try {
            $stmt = db()->prepare('INSERT INTO pins (name, address, name_lower, address_lower, lat, lng, created_at, created_by)
                VALUES (:name, :address, :name_lower, :address_lower, :lat, :lng, :created_at, :created_by)');
            $stmt->execute([
                ':name' => $name,
                ':address' => $address,
                ':name_lower' => $nameLower,
                ':address_lower' => $addressLower,
                ':lat' => (float)$lat,
                ':lng' => (float)$lng,
                ':created_at' => $createdAt,
                ':created_by' => (int)$user['id'],
            ]);
        } catch (PDOException $e) {
            if ($e->getCode() === '23000') {
                json_response(false, '此店家已存在，不能重複新增。', 409);
                break;
            }
            json_response(false, '新增失敗，請稍後再試。', 500);
            break;
        }

        $id = (int)db()->lastInsertId();
        $stmt = db()->prepare('SELECT * FROM pins WHERE id = :id');
        $stmt->execute([':id' => $id]);
        $row = $stmt->fetch();
        json_response(true, ['pin' => pin_to_output($row)]);
        break;
    }

    case 'pins:update': {
        require_admin();
        $id = (int)($input['id'] ?? 0);
        $name = trim((string)($input['name'] ?? ''));
        $address = trim((string)($input['address'] ?? ''));
        $lat = $input['lat'] ?? null;
        $lng = $input['lng'] ?? null;

        if ($id <= 0 || $name === '' || $address === '') {
            json_response(false, '資料不完整。', 400);
            break;
        }
        if (!is_numeric($lat) || !is_numeric($lng)) {
            json_response(false, '座標格式不正確。', 400);
            break;
        }

        $nameLower = normalize_text($name);
        $addressLower = normalize_text($address);
        $stmt = db()->prepare('SELECT id FROM pins WHERE name_lower = :name_lower AND address_lower = :address_lower AND id != :id LIMIT 1');
        $stmt->execute([
            ':name_lower' => $nameLower,
            ':address_lower' => $addressLower,
            ':id' => $id,
        ]);
        if ($stmt->fetch()) {
            json_response(false, '此店家已存在，不能重複新增。', 409);
            break;
        }

        $stmt = db()->prepare('UPDATE pins SET name = :name, address = :address, name_lower = :name_lower, address_lower = :address_lower, lat = :lat, lng = :lng WHERE id = :id');
        $stmt->execute([
            ':name' => $name,
            ':address' => $address,
            ':name_lower' => $nameLower,
            ':address_lower' => $addressLower,
            ':lat' => (float)$lat,
            ':lng' => (float)$lng,
            ':id' => $id,
        ]);

        $stmt = db()->prepare('SELECT * FROM pins WHERE id = :id');
        $stmt->execute([':id' => $id]);
        $row = $stmt->fetch();
        json_response(true, ['pin' => pin_to_output($row)]);
        break;
    }

    case 'pins:delete': {
        require_admin();
        $id = (int)($input['id'] ?? 0);
        if ($id <= 0) {
            json_response(false, '缺少資料 ID。', 400);
            break;
        }
        $stmt = db()->prepare('DELETE FROM pins WHERE id = :id');
        $stmt->execute([':id' => $id]);
        json_response(true, null);
        break;
    }

    case 'pins:clear': {
        require_admin();
        db()->exec('DELETE FROM pins');
        json_response(true, null);
        break;
    }

    case 'users:list': {
        require_admin();
        $stmt = db()->query('SELECT * FROM users ORDER BY created_at ASC');
        $rows = $stmt->fetchAll();
        $users = array_map('user_to_output', $rows);
        json_response(true, ['users' => $users]);
        break;
    }

    case 'users:create': {
        require_admin();
        $username = trim((string)($input['username'] ?? ''));
        $password = (string)($input['password'] ?? '');

        if ($username === '' || $password === '') {
            json_response(false, '請輸入帳號與密碼。', 400);
            break;
        }
        if (strlen($password) < 6) {
            json_response(false, '密碼至少 6 碼。', 400);
            break;
        }

        $normalized = normalize_text($username);
        $stmt = db()->prepare('SELECT id FROM users WHERE username_lower = :u LIMIT 1');
        $stmt->execute([':u' => $normalized]);
        if ($stmt->fetch()) {
            json_response(false, '帳號已存在。', 409);
            break;
        }

        $hash = password_hash($password, PASSWORD_DEFAULT);
        $stmt = db()->prepare('INSERT INTO users (username, username_lower, password_hash, role, active, created_at, last_login_status)
            VALUES (:username, :username_lower, :password_hash, :role, :active, :created_at, :last_login_status)');
        $stmt->execute([
            ':username' => $username,
            ':username_lower' => $normalized,
            ':password_hash' => $hash,
            ':role' => 'user',
            ':active' => 1,
            ':created_at' => date('c'),
            ':last_login_status' => '尚未登入',
        ]);

        json_response(true, null);
        break;
    }

    case 'users:toggle': {
        require_admin();
        $id = (int)($input['id'] ?? 0);
        if ($id <= 0) {
            json_response(false, '缺少帳號 ID。', 400);
            break;
        }
        $user = get_user_by_id($id);
        if (!$user) {
            json_response(false, '找不到帳號。', 404);
            break;
        }
        $nextActive = ((int)$user['active']) === 1 ? 0 : 1;
        $stmt = db()->prepare('UPDATE users SET active = :active WHERE id = :id');
        $stmt->execute([':active' => $nextActive, ':id' => $id]);
        json_response(true, ['active' => $nextActive === 1]);
        break;
    }

    case 'users:delete': {
        require_admin();
        $id = (int)($input['id'] ?? 0);
        if ($id <= 0) {
            json_response(false, '缺少帳號 ID。', 400);
            break;
        }
        $stmt = db()->prepare('DELETE FROM users WHERE id = :id');
        $stmt->execute([':id' => $id]);
        json_response(true, null);
        break;
    }

    case 'users:login_location': {
        $user = require_login();
        $lastLoginAt = to_iso($input['lastLoginAt'] ?? null);
        $lastLoginLat = $input['lastLoginLat'] ?? null;
        $lastLoginLng = $input['lastLoginLng'] ?? null;
        $lastLoginAccuracy = $input['lastLoginAccuracy'] ?? null;
        $lastLoginStatus = (string)($input['lastLoginStatus'] ?? '');

        $stmt = db()->prepare('UPDATE users SET last_login_at = :last_login_at, last_login_lat = :last_login_lat, last_login_lng = :last_login_lng, last_login_accuracy = :last_login_accuracy, last_login_status = :last_login_status WHERE id = :id');
        $stmt->execute([
            ':last_login_at' => $lastLoginAt,
            ':last_login_lat' => is_numeric($lastLoginLat) ? (float)$lastLoginLat : null,
            ':last_login_lng' => is_numeric($lastLoginLng) ? (float)$lastLoginLng : null,
            ':last_login_accuracy' => is_numeric($lastLoginAccuracy) ? (float)$lastLoginAccuracy : null,
            ':last_login_status' => $lastLoginStatus,
            ':id' => (int)$user['id'],
        ]);
        json_response(true, null);
        break;
    }

    default:
        json_response(false, '未知的操作。', 404);
        break;
}
