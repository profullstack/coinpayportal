<?php

/**
 * Tiny assertion harness — intentionally zero dependencies so the tests run
 * in CI and on fresh dev boxes without composer/phpunit installed. Good
 * enough for contract-level tests. Move to PHPUnit if we grow beyond ~50
 * cases.
 */

if ( ! function_exists('coinpay_test_run') ) {
    $GLOBALS['__coinpay_test_count']  = 0;
    $GLOBALS['__coinpay_test_failed'] = 0;

    function coinpay_test_run(string $label, callable $fn): void
    {
        $GLOBALS['__coinpay_test_count']++;
        try {
            $fn();
            echo "[pass] $label\n";
        } catch (\Throwable $e) {
            $GLOBALS['__coinpay_test_failed']++;
            echo "[FAIL] $label — " . $e->getMessage() . "\n";
            echo "       at " . $e->getFile() . ":" . $e->getLine() . "\n";
        }
    }

    function coinpay_test_summary(): void
    {
        $count  = (int) $GLOBALS['__coinpay_test_count'];
        $failed = (int) $GLOBALS['__coinpay_test_failed'];
        $passed = $count - $failed;
        echo "\n$passed/$count passed";
        if ($failed > 0) {
            echo " — $failed FAILED\n";
            exit(1);
        }
        echo "\n";
    }

    function coinpay_assert_true($cond, string $why = ''): void
    {
        if (!$cond) {
            throw new \RuntimeException('expected true' . ($why ? " ($why)" : ''));
        }
    }

    function coinpay_assert_equals($expected, $actual, string $why = ''): void
    {
        if ($expected !== $actual) {
            $e = is_scalar($expected) ? (string) $expected : json_encode($expected);
            $a = is_scalar($actual)   ? (string) $actual   : json_encode($actual);
            throw new \RuntimeException("expected `$e` got `$a`" . ($why ? " ($why)" : ''));
        }
    }

    function coinpay_assert_contains(string $needle, string $haystack, string $why = ''): void
    {
        if (strpos($haystack, $needle) === false) {
            throw new \RuntimeException("expected substring `$needle` in `$haystack`" . ($why ? " ($why)" : ''));
        }
    }

    function coinpay_assert_throws(callable $fn, string $expectedExceptionClass, string $why = ''): \Throwable
    {
        try {
            $fn();
        } catch (\Throwable $e) {
            if (!($e instanceof $expectedExceptionClass)) {
                throw new \RuntimeException("expected $expectedExceptionClass, got " . get_class($e) . ": " . $e->getMessage() . ($why ? " ($why)" : ''));
            }
            return $e;
        }
        throw new \RuntimeException("expected $expectedExceptionClass to be thrown" . ($why ? " ($why)" : ''));
    }
}
