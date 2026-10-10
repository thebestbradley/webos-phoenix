<?php
// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The database: one schema for MySQL/MariaDB and SQLite (the column types
// both take; ids are app ids or integers from autoincrement).

declare(strict_types=1);

namespace Phoenix\Marketplace;

use PDO;

final class Db
{
    public PDO $pdo;
    public string $driver;

    public function __construct(array $config)
    {
        if (str_starts_with($config['dsn'], 'sqlite:')) {
            @mkdir(dirname(substr($config['dsn'], 7)), 0700, true);
        }
        $this->pdo = new PDO($config['dsn'], $config['db_user'], $config['db_pass'], [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        ]);
        $this->driver = $this->pdo->getAttribute(PDO::ATTR_DRIVER_NAME);
        if ($this->driver === 'sqlite') {
            $this->pdo->exec('PRAGMA foreign_keys = ON');
            $this->pdo->exec('PRAGMA busy_timeout = 5000');
        }
    }

    public function migrate(): void
    {
        $auto = $this->driver === 'sqlite' ? 'INTEGER PRIMARY KEY AUTOINCREMENT' : 'INTEGER PRIMARY KEY AUTO_INCREMENT';
        $text = $this->driver === 'sqlite' ? 'TEXT' : 'MEDIUMTEXT';
        $key = $this->driver === 'sqlite' ? 'TEXT' : 'VARCHAR(190)';
        $engine = $this->driver === 'mysql' ? ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4' : '';
        $tables = [
            "CREATE TABLE IF NOT EXISTS accounts (
                id $auto, name VARCHAR(80) NOT NULL, email VARCHAR(190) NOT NULL,
                role VARCHAR(16) NOT NULL, token_hash CHAR(64) NOT NULL UNIQUE, created VARCHAR(32) NOT NULL)$engine",
            "CREATE TABLE IF NOT EXISTS apps (
                id $key PRIMARY KEY, kind VARCHAR(16) NOT NULL, owner_id INTEGER NULL, title VARCHAR(80) NOT NULL,
                developer_name VARCHAR(80) NOT NULL, developer_url VARCHAR(500) NOT NULL DEFAULT '',
                summary VARCHAR(300) NOT NULL DEFAULT '', description $text, categories VARCHAR(500) NOT NULL DEFAULT '[]',
                icon VARCHAR(1000) NOT NULL DEFAULT '', screenshots $text, license VARCHAR(80) NOT NULL DEFAULT '',
                homepage VARCHAR(500) NOT NULL DEFAULT '', donation VARCHAR(500) NOT NULL DEFAULT '',
                featured INTEGER NOT NULL DEFAULT 0, manifest VARCHAR(1000) NOT NULL DEFAULT '', origin VARCHAR(300) NOT NULL DEFAULT '',
                version VARCHAR(40) NOT NULL DEFAULT '1.0.0', status VARCHAR(16) NOT NULL, curated INTEGER NOT NULL DEFAULT 0,
                created VARCHAR(32) NOT NULL, updated VARCHAR(32) NOT NULL)$engine",
            "CREATE TABLE IF NOT EXISTS releases (
                id $auto, app_id $key NOT NULL, version VARCHAR(40) NOT NULL, file VARCHAR(255) NOT NULL,
                size INTEGER NOT NULL, sha256 CHAR(64) NOT NULL, state VARCHAR(16) NOT NULL, notes $text,
                reviewer_id INTEGER NULL, created VARCHAR(32) NOT NULL, decided VARCHAR(32) NULL)$engine",
            "CREATE TABLE IF NOT EXISTS reviews (
                id $auto, app_id $key NOT NULL, account_id INTEGER NOT NULL, stars INTEGER NOT NULL, text $text,
                hidden INTEGER NOT NULL DEFAULT 0, created VARCHAR(32) NOT NULL, UNIQUE (app_id, account_id))$engine",
            "CREATE TABLE IF NOT EXISTS reports (
                id $auto, app_id $key NOT NULL, kind VARCHAR(16) NOT NULL, text $text, contact VARCHAR(190) NOT NULL DEFAULT '',
                state VARCHAR(16) NOT NULL, created VARCHAR(32) NOT NULL)$engine",
            "CREATE TABLE IF NOT EXISTS optouts (
                id $auto, origin VARCHAR(300) NOT NULL, contact VARCHAR(190) NOT NULL, text $text,
                state VARCHAR(16) NOT NULL, created VARCHAR(32) NOT NULL)$engine",
            "CREATE TABLE IF NOT EXISTS index_builds (
                build INTEGER PRIMARY KEY, generated VARCHAR(32) NOT NULL, sha256 CHAR(64) NOT NULL)$engine",
        ];
        foreach ($tables as $sql) {
            $this->pdo->exec($sql);
        }
        // apps.kind was VARCHAR(8) before connector packages ("connector"; SQLite does not
        // mind the width).
        if ($this->driver === 'mysql') {
            $this->pdo->exec('ALTER TABLE apps MODIFY kind VARCHAR(16) NOT NULL');
        }
    }

    public function one(string $sql, array $args = []): ?array
    {
        $st = $this->pdo->prepare($sql);
        $st->execute($args);
        $row = $st->fetch();
        return $row === false ? null : $row;
    }

    public function all(string $sql, array $args = []): array
    {
        $st = $this->pdo->prepare($sql);
        $st->execute($args);
        return $st->fetchAll();
    }

    public function run(string $sql, array $args = []): int
    {
        $st = $this->pdo->prepare($sql);
        $st->execute($args);
        return $st->rowCount();
    }

    public function lastId(): int
    {
        return (int) $this->pdo->lastInsertId();
    }

    public static function now(): string
    {
        return gmdate('Y-m-d\TH:i:s\Z');
    }
}
