<?php

declare(strict_types=1);

/*
 * MikoPBX - free phone system for small business
 * Copyright © 2017-2026 Alexey Portnov and Nikolay Beketov
 */

namespace Modules\ModulePhraseStudio\App\Controllers;

use MikoPBX\AdminCabinet\Controllers\BaseController;
use MikoPBX\AdminCabinet\Providers\AssetProvider;
use Modules\ModulePhraseStudio\Models\ModulePhraseStudio;

/**
 * Web admin controller for the Phrase Studio module.
 *
 * The Studio page is a single tabbed view (Studio / Voices / Engine / History).
 * The "remember as default" checkbox in the Studio tab persists the user's
 * voice + sample-rate choice via saveAction() so the next visit pre-selects them.
 *
 * @package Modules\ModulePhraseStudio\App\Controllers
 */
class ModulePhraseStudioController extends BaseController
{
    private string $moduleUniqueID = 'ModulePhraseStudio';

    public function initialize(): void
    {
        $this->view->logoImagePath = $this->url->get() . 'assets/img/cache/' . $this->moduleUniqueID . '/logo.svg';
        $this->view->submitMode    = null;
        parent::initialize();
    }

    public function indexAction(): void
    {
        $headerCSS = $this->assets->collection(AssetProvider::HEADER_CSS);
        $headerCSS
            ->addCss('css/vendor/datatable/dataTables.semanticui.min.css', true)
            ->addCss('css/cache/' . $this->moduleUniqueID . '/module-phrase-studio-index.css', true);

        $footerJS = $this->assets->collection(AssetProvider::FOOTER_JS);
        $footerJS
            ->addJs('js/vendor/datatable/dataTables.semanticui.js', true)
            ->addJs('js/pbx/SoundFiles/sound-files-index-player.js', true)
            ->addJs('js/cache/' . $this->moduleUniqueID . '/module-phrase-studio-index.js', true);

        $settings = ModulePhraseStudio::findFirst();
        if ($settings === null) {
            $settings = new ModulePhraseStudio();
        }

        $this->view->phraseStudioDefaults = [
            'voice'      => (string)($settings->default_voice ?? ''),
            'sampleRate' => (string)($settings->default_sample_rate ?? 'native'),
        ];
        $this->view->pick('Modules/' . $this->moduleUniqueID . '/ModulePhraseStudio/index');
    }

    /**
     * Stores voice + sample-rate as defaults when the user ticks
     * "remember" in the Studio tab. Called via JS, returns JSON.
     */
    public function saveAction(): void
    {
        $this->view->disable();
        $this->response->setContentType('application/json');

        if (!$this->request->isPost()) {
            $this->response->setJsonContent(['result' => false, 'message' => 'POST required']);
            $this->response->send();
            return;
        }

        $voice      = (string)$this->request->getPost('default_voice', null, '');
        $sampleRate = (string)$this->request->getPost('default_sample_rate', null, 'native');

        $record = ModulePhraseStudio::findFirst();
        if ($record === null) {
            $record = new ModulePhraseStudio();
        }
        $record->default_voice       = $voice;
        $record->default_sample_rate = $sampleRate;

        $ok = $record->save();
        $this->response->setJsonContent([
            'result' => (bool)$ok,
            'data'   => [
                'default_voice'       => $voice,
                'default_sample_rate' => $sampleRate,
            ],
        ]);
        $this->response->send();
    }
}
