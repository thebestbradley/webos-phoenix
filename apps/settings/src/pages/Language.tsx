// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Language & Region. Service: com.webos.settingsservice get/setSystemSettings
// {keys:["localeInfo"]}: localeInfo.locales.UI is the language, FMT the
// region used for dates, times and numbers. Units (Phoenix's
// {measurementUnits}, @phoenix/luna units.ts): the one setting Maps, the
// Weather and the Assistant follow; Automatic goes by the region.

import { settings, systemFor, UNITS_KEY, units, type LocaleInfo, type UnitsSetting } from "@phoenix/luna";
import { useLuna } from "@phoenix/luna/react";
import { Group, ListSelector, Note, Page, PageHeader, Row } from "@phoenix/ui";

const LANGUAGES = [
    { label: "English", value: "en-US" },
    { label: "English (UK)", value: "en-GB" },
    { label: "Deutsch", value: "de-DE" },
    { label: "Español", value: "es-ES" },
    { label: "Français", value: "fr-FR" },
    { label: "Italiano", value: "it-IT" },
    { label: "Português (Brasil)", value: "pt-BR" },
    { label: "日本語", value: "ja-JP" },
    { label: "한국어", value: "ko-KR" },
    { label: "中文 (简体)", value: "zh-CN" },
];

const REGIONS = [
    { label: "United States", value: "en-US" },
    { label: "United Kingdom", value: "en-GB" },
    { label: "Canada", value: "en-CA" },
    { label: "Australia", value: "en-AU" },
    { label: "Germany", value: "de-DE" },
    { label: "France", value: "fr-FR" },
    { label: "Spain", value: "es-ES" },
    { label: "Italy", value: "it-IT" },
    { label: "Mexico", value: "es-MX" },
    { label: "Brazil", value: "pt-BR" },
    { label: "Japan", value: "ja-JP" },
    { label: "Korea", value: "ko-KR" },
    { label: "China", value: "zh-CN" },
];

function sample(locale: string) {
    const d = new Date(2009, 5, 6, 21, 41);
    try {
        return {
            date: new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(d),
            time: new Intl.DateTimeFormat(locale, { timeStyle: "short" }).format(d),
            number: new Intl.NumberFormat(locale).format(1234567.89),
            currency: new Intl.NumberFormat(locale, { style: "currency", currency: currencyOf(locale) }).format(199.99),
        };
    } catch {
        return null;
    }
}

function currencyOf(locale: string) {
    const region = locale.split("-")[1];
    return ({ US: "USD", GB: "GBP", CA: "CAD", AU: "AUD", MX: "MXN", BR: "BRL", JP: "JPY", KR: "KRW", CN: "CNY" } as Record<string, string>)[region] ?? "EUR";
}

export function LanguagePage() {
    const info = useLuna<LocaleInfo | undefined>((cb, err) => settings.watch("", ["localeInfo"], (s) => cb(s.localeInfo), err), []).value;
    const unitsSetting = useLuna<UnitsSetting>((cb, err) => settings.watch("", [UNITS_KEY], (s) => cb((s[UNITS_KEY] as UnitsSetting) ?? "auto"), err), []).value ?? "auto";
    const ui = info?.locales.UI ?? "en-US";
    const fmt = info?.locales.FMT ?? ui;
    const update = (locales: LocaleInfo["locales"]) =>
        void settings.set("", { localeInfo: { ...(info ?? { locales: {} }), locales: { ...info?.locales, ...locales } } });
    const ex = sample(fmt);
    return (
        <Page>
            <PageHeader title="Language & Region" icon="icons/language.png" />
            <Group label="Language">
                <ListSelector title="Language" value={ui} options={LANGUAGES} disabled={!info} testId="language"
                              onChange={(v) => update({ UI: v })} />
            </Group>
            <Note>Apps show the new language the next time they start.</Note>
            <Group label="Region">
                <ListSelector title="Region" value={fmt} options={REGIONS} disabled={!info} testId="region"
                              onChange={(v) => update({ FMT: v })} />
            </Group>
            <Group label="Units">
                <ListSelector title="Units" value={unitsSetting} testId="units" disabled={!info}
                              options={[
                                  { label: `Automatic (${systemFor("auto", fmt) === "imperial" ? "miles, °F" : "km, °C"})`, value: "auto" as const },
                                  { label: "Metric (km, °C)", value: "metric" as const },
                                  { label: "Imperial (miles, °F)", value: "imperial" as const },
                              ]}
                              onChange={(v) => void units.set(v)} />
            </Group>
            <Note>Maps, the Weather and the Assistant use these units.</Note>
            {ex && (
                <Group label="Formats">
                    <Row title="Date" value={ex.date} />
                    <Row title="Time" value={ex.time} />
                    <Row title="Number" value={ex.number} />
                    <Row title="Currency" value={ex.currency} />
                </Group>
            )}
        </Page>
    );
}
