<?php

namespace CoinPay;

class ApiException extends \RuntimeException
{
    /** @var int */
    private $httpStatus;

    /** @var array|null */
    private $responseBody;

    public function __construct(string $message, int $httpStatus = 0, ?array $responseBody = null, ?\Throwable $previous = null)
    {
        parent::__construct($message, $httpStatus, $previous);
        $this->httpStatus = $httpStatus;
        $this->responseBody = $responseBody;
    }

    public function getHttpStatus(): int
    {
        return $this->httpStatus;
    }

    public function getResponseBody(): ?array
    {
        return $this->responseBody;
    }
}
