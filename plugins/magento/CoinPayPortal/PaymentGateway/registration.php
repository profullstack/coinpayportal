<?php
declare(strict_types=1);

// Stub registration for the CoinPayPortal Magento 2 module.
// Real component logic lives under Model/, Controller/, etc/ once this
// plugin moves out of stub status.

\Magento\Framework\Component\ComponentRegistrar::register(
    \Magento\Framework\Component\ComponentRegistrar::MODULE,
    'CoinPayPortal_PaymentGateway',
    __DIR__
);
