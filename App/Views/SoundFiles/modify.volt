<div class="ui segment phrase-studio-soundfiles-block" id="phrase-studio-sf-segment">
    <h4 class="ui dividing header">
        <i class="microphone alternate icon"></i>
        <div class="content">
            {{ t._('module_phrase_studio_SoundFilesHookHeader') }}
            <div class="sub header">{{ t._('module_phrase_studio_SoundFilesHookSub') }}</div>
        </div>
    </h4>

    <div class="field" id="phrase-studio-sf-history-field" style="display:none;">
        <label>{{ t._('module_phrase_studio_SoundFilesHookHistoryLabel') }}</label>
        <select class="ui search dropdown" id="phrase-studio-sf-history">
            <option value="">{{ t._('module_phrase_studio_SoundFilesHookHistoryPlaceholder') }}</option>
        </select>
    </div>

    <div class="field">
        <label for="phrase-studio-sf-text">{{ t._('module_phrase_studio_TextLabel') }}</label>
        <textarea id="phrase-studio-sf-text" rows="3" maxlength="800"
                  placeholder="{{ t._('module_phrase_studio_TextPlaceholder') }}"></textarea>
        <div class="ui small label" id="phrase-studio-sf-counter">0 / 800</div>
    </div>

    <div class="two fields">
        <div class="field">
            <label>{{ t._('module_phrase_studio_VoiceLabel') }}</label>
            <select class="ui search dropdown" id="phrase-studio-sf-voice"></select>
        </div>
        <div class="field">
            <label>{{ t._('module_phrase_studio_SampleRateLabel') }}</label>
            <select class="ui dropdown" id="phrase-studio-sf-sample-rate">
                <option value="native">{{ t._('module_phrase_studio_SampleRateNative') }}</option>
                <option value="telephony">{{ t._('module_phrase_studio_SampleRateTelephony') }}</option>
            </select>
        </div>
    </div>

    <button class="ui primary button" id="phrase-studio-sf-generate" type="button">
        <i class="magic icon"></i>
        {{ t._('module_phrase_studio_SoundFilesHookGenerate') }}
    </button>

    <div class="ui small text phrase-studio-sf-status" id="phrase-studio-sf-status"></div>
</div>
