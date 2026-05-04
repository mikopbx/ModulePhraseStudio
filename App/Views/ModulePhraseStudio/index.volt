<script>
    window.phraseStudioDefaults = {
        voice:      "{{ phraseStudioDefaults['voice'] }}",
        sampleRate: "{{ phraseStudioDefaults['sampleRate'] }}"
    };
</script>

<div class="ui top attached tabular menu" id="phrase-studio-tab-menu">
    <a class="item active" data-tab="studio">{{ t._('module_phrase_studio_TabStudio') }}</a>
    <a class="item" data-tab="voices">{{ t._('module_phrase_studio_TabVoices') }}</a>
    <a class="item" data-tab="engine">{{ t._('module_phrase_studio_TabEngine') }}</a>
    <a class="item" data-tab="history">{{ t._('module_phrase_studio_TabHistory') }}</a>
</div>

<div class="ui bottom attached tab segment active" data-tab="studio">
    {{ partial("Modules/ModulePhraseStudio/ModulePhraseStudio/IndexTabs/tabStudio") }}
</div>
<div class="ui bottom attached tab segment" data-tab="voices">
    {{ partial("Modules/ModulePhraseStudio/ModulePhraseStudio/IndexTabs/tabVoices") }}
</div>
<div class="ui bottom attached tab segment" data-tab="engine">
    {{ partial("Modules/ModulePhraseStudio/ModulePhraseStudio/IndexTabs/tabEngine") }}
</div>
<div class="ui bottom attached tab segment" data-tab="history">
    {{ partial("Modules/ModulePhraseStudio/ModulePhraseStudio/IndexTabs/tabHistory") }}
</div>
