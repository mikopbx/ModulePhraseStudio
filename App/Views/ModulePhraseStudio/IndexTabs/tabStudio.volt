<div class="ui form" id="phrase-studio-generate-form">
    <div class="field">
        <label for="phrase-studio-text">{{ t._('module_phrase_studio_TextLabel') }}</label>
        <textarea id="phrase-studio-text" rows="4"
                  maxlength="800"
                  placeholder="{{ t._('module_phrase_studio_TextPlaceholder') }}"></textarea>
        <div class="ui small label" id="phrase-studio-text-counter">0 / 800</div>
    </div>

    <div class="two fields">
        <div class="field">
            <label>{{ t._('module_phrase_studio_VoiceLabel') }}</label>
            <select class="ui search dropdown" id="phrase-studio-voice"></select>
        </div>
        <div class="field">
            <label>{{ t._('module_phrase_studio_SampleRateLabel') }}</label>
            <select class="ui dropdown" id="phrase-studio-sample-rate">
                <option value="native">{{ t._('module_phrase_studio_SampleRateNative') }}</option>
                <option value="telephony">{{ t._('module_phrase_studio_SampleRateTelephony') }}</option>
            </select>
        </div>
    </div>

    <div class="field">
        <div class="ui checkbox" id="phrase-studio-remember-checkbox">
            <input type="checkbox" id="phrase-studio-remember">
            <label for="phrase-studio-remember">{{ t._('module_phrase_studio_RememberDefaults') }}</label>
        </div>
    </div>

    <button class="ui primary button" id="phrase-studio-generate-button" type="button">
        {{ t._('module_phrase_studio_GenerateButton') }}
    </button>

    <div class="ui hidden divider"></div>
    <div class="ui basic segment" id="phrase-studio-result" style="display:none;">
        <audio controls id="phrase-studio-player" style="width: 100%;"></audio>
        <div class="ui horizontal divider"></div>
        <a class="ui green button" id="phrase-studio-download-link" href="#" target="_blank">
            {{ t._('module_phrase_studio_DownloadButton') }}
        </a>
    </div>
</div>
