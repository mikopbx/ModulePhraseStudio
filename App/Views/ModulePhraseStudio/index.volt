<script>
    window.phraseStudioDefaults = {
        voice:      "{{ phraseStudioDefaults['voice'] }}",
        sampleRate: "{{ phraseStudioDefaults['sampleRate'] }}",
        disabled:   {{ phraseStudioDefaults['disabled'] ? 'true' : 'false' }}
    };
</script>

{% if phraseStudioDefaults['disabled'] %}
<div class="ui icon warning message" id="phrase-studio-disabled-message">
    <i class="power off icon"></i>
    <div class="content">
        <div class="header">{{ t._('module_phrase_studio_DisabledHeader') }}</div>
        <p>{{ t._('module_phrase_studio_DisabledHint') }}</p>
    </div>
</div>
{% endif %}

<div class="ui top attached tabular menu {% if phraseStudioDefaults['disabled'] %}disabled{% endif %}" id="phrase-studio-tab-menu">
    <a class="item active" data-tab="studio">{{ t._('module_phrase_studio_TabStudio') }}</a>
    <a class="item" data-tab="voices">{{ t._('module_phrase_studio_TabVoices') }}</a>
    <a class="item" data-tab="engine">{{ t._('module_phrase_studio_TabEngine') }}</a>
</div>

<div class="ui bottom attached tab segment active {% if phraseStudioDefaults['disabled'] %}disabled{% endif %}" data-tab="studio">
    {{ partial("Modules/ModulePhraseStudio/ModulePhraseStudio/IndexTabs/tabStudio") }}

    <div class="ui hidden divider"></div>
    <h3 class="ui dividing header">{{ t._('module_phrase_studio_HistoryHeader') }}</h3>
    {{ partial("Modules/ModulePhraseStudio/ModulePhraseStudio/IndexTabs/tabHistory") }}
</div>
<div class="ui bottom attached tab segment {% if phraseStudioDefaults['disabled'] %}disabled{% endif %}" data-tab="voices">
    {{ partial("Modules/ModulePhraseStudio/ModulePhraseStudio/IndexTabs/tabVoices") }}
</div>
<div class="ui bottom attached tab segment {% if phraseStudioDefaults['disabled'] %}disabled{% endif %}" data-tab="engine">
    {{ partial("Modules/ModulePhraseStudio/ModulePhraseStudio/IndexTabs/tabEngine") }}
</div>
