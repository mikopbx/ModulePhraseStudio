<?php

declare(strict_types=1);

/*
 * MikoPBX - free phone system for small business
 * Copyright © 2017-2026 Alexey Portnov and Nikolay Beketov
 */

namespace Modules\ModulePhraseStudio\Lib\Engines;

/**
 * Common contract for all TTS engines plugged into ModulePhraseStudio.
 *
 * Currently implemented: PiperEngine.
 * Future implementations may wrap RHVoice, MMS-TTS, etc. without
 * touching the controllers, processors or the Studio UI.
 *
 * @package Modules\ModulePhraseStudio\Lib\Engines
 */
interface EngineInterface
{
    /**
     * Returns the engine's machine identifier (e.g. "piper").
     */
    public function getId(): string;

    /**
     * Returns true when the engine binary is installed locally and runnable.
     */
    public function isInstalled(): bool;

    /**
     * Returns the engine version string (e.g. "1.2.0") or empty if not installed.
     */
    public function getVersion(): string;

    /**
     * Returns the installed binary path or empty string if not installed.
     */
    public function getBinaryPath(): string;

    /**
     * Downloads, extracts and verifies the engine binary.
     *
     * @return array{success: bool, message: string, version?: string}
     */
    public function install(): array;

    /**
     * Removes the engine binary and any auxiliary files (espeak-ng-data, etc.).
     *
     * @return array{success: bool, message: string}
     */
    public function uninstall(): array;

    /**
     * Synthesises $text into a 16-bit PCM .wav file at $outputPath using $voiceId.
     *
     * The implementation is responsible for verifying that the model files for
     * $voiceId are present locally. It must NOT perform any network calls.
     *
     * @param string $text       Text to synthesise (UTF-8).
     * @param string $voiceId    Voice ID (e.g. "ru_RU-irina-medium").
     * @param string $outputPath Absolute path of the .wav file to create.
     *
     * @return array{success: bool, message: string, sample_rate?: int}
     */
    public function synthesize(string $text, string $voiceId, string $outputPath): array;
}
