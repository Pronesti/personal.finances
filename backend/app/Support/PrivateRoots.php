<?php

namespace App\Support;

use RuntimeException;

class PrivateRoots
{
    public static function canonical(string $path): string
    {
        if ($path === '' || ! str_starts_with($path, '/') || realpath($path) !== $path || ! is_dir($path)) {
            throw new RuntimeException('test_target_unsafe_root');
        }
        $part = '';
        foreach (explode('/', ltrim($path, '/')) as $segment) {
            $part .= '/'.$segment;
            if (is_link($part)) {
                throw new RuntimeException('test_target_symlink_root');
            }
        }
        if ((fileperms($path) & 0077) !== 0 || ! is_writable($path)) {
            throw new RuntimeException('test_target_root_not_private');
        }

        return $path;
    }

    public static function overlap(string $first, string $second): bool
    {
        return $first === $second || str_starts_with($first, $second.'/') || str_starts_with($second, $first.'/');
    }

    /** @param list<string> $roots @param list<string> $protected */
    public static function assertDisjoint(array $roots, array $protected): void
    {
        foreach ($roots as $index => $root) {
            self::canonical($root);
            foreach (array_merge(array_slice($roots, $index + 1), $protected) as $other) {
                if (! is_string($other) || $other === '' || ! str_starts_with($other, '/') || self::overlap($root, $other)) {
                    throw new RuntimeException('test_target_overlapping_roots');
                }
            }
        }
    }
}
