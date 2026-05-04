<div id="phrase-studio-history-empty" style="display:none;">
    <div class="ui placeholder segment">
        <div class="ui icon header">
            <i class="music icon"></i>
            {{ t._('module_phrase_studio_HistoryEmptyTitle') }}
        </div>
        <div class="inline">
            <div class="ui text">
                {{ t._('module_phrase_studio_HistoryEmptyDescription') }}
            </div>
        </div>
    </div>
</div>

<table class="ui selectable very compact unstackable table" id="phrase-studio-history-table">
    <thead>
        <tr>
            <th>{{ t._('module_phrase_studio_HistoryColCreated') }}</th>
            <th>{{ t._('module_phrase_studio_HistoryColText') }}</th>
            <th>{{ t._('module_phrase_studio_HistoryColVoice') }}</th>
            <th class="six wide hide-on-mobile">{{ t._('module_phrase_studio_HistoryColPlayer') }}</th>
            <th class="collapsing"></th>
        </tr>
    </thead>
    <tbody></tbody>
</table>
