// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// Weather icons, drawn for Phoenix in the glossy webOS 2.x manner: a sun,
// a moon, clouds and what falls from them. One SVG, 64x64 units.

import { useId } from "react";
import type { Sky } from "./lib/codes";

function Sun({ id, x = 32, y = 32, r = 13 }: { id: string; x?: number; y?: number; r?: number }) {
    const rays = Array.from({ length: 8 }, (_, i) => {
        const a = (i * Math.PI) / 4;
        return <line key={i} x1={x + Math.cos(a) * (r + 4)} y1={y + Math.sin(a) * (r + 4)} x2={x + Math.cos(a) * (r + 10)} y2={y + Math.sin(a) * (r + 10)}
                     stroke="#f5b800" strokeWidth="3.4" strokeLinecap="round" />;
    });
    return (
        <g>
            {rays}
            <circle cx={x} cy={y} r={r} fill={`url(#${id}-sun)`} stroke="#d48a00" strokeWidth="1" />
        </g>
    );
}

function Moon({ id, x = 32, y = 30, r = 15 }: { id: string; x?: number; y?: number; r?: number }) {
    return <path d={`M${x + r * 0.35} ${y - r} a${r} ${r} 0 1 0 ${r * 0.65} ${r * 1.55} a${r * 0.95} ${r * 0.95} 0 0 1 ${-r * 0.65} ${-r * 1.55}z`}
                 fill={`url(#${id}-moon)`} stroke="#8d95a8" strokeWidth="1" />;
}

function Cloud({ id, dark, dx = 0, dy = 0, s = 1 }: { id: string; dark?: boolean; dx?: number; dy?: number; s?: number }) {
    return (
        <path transform={`translate(${dx} ${dy}) scale(${s})`}
              d="M18 48h30a10 10 0 0 0 1-19.9A13 13 0 0 0 24.3 24 9 9 0 0 0 10 32.5 8 8 0 0 0 18 48z"
              fill={`url(#${id}-${dark ? "dark" : "cloud"})`} stroke={dark ? "#4f5661" : "#8c96a3"} strokeWidth="1.2" />
    );
}

const drops = (color: string, snow = false) => [16, 28, 40].map((x, i) =>
    snow
        ? <circle key={x} cx={x + 4} cy={55 + (i % 2) * 4} r="2.6" fill="#fff" stroke="#8fb4d9" strokeWidth="1" />
        : <line key={x} x1={x + 6} y1={51 + (i % 2) * 3} x2={x + 2} y2={59 + (i % 2) * 3} stroke={color} strokeWidth="3" strokeLinecap="round" />);

export function WeatherIcon({ sky, night = false, size = 48, className }: { sky: Sky; night?: boolean; size?: number; className?: string }) {
    const id = "wx" + useId().replace(/:/g, "");
    const body = (() => {
        switch (sky) {
        case "clear": return night ? <Moon id={id} /> : <Sun id={id} />;
        case "partly":
            return <>{night ? <Moon id={id} x={24} y={20} r={12} /> : <Sun id={id} x={22} y={22} r={10} />}<Cloud id={id} dx={4} dy={2} s={0.95} /></>;
        case "cloudy": return <><Cloud id={id} dark dx={-6} dy={-8} s={0.8} /><Cloud id={id} dx={2} dy={0} /></>;
        case "fog":
            return <><Cloud id={id} dy={-6} />{[46, 52, 58].map((y, i) =>
                <line key={y} x1={10 + i * 3} y1={y} x2={54 - i * 3} y2={y} stroke="#9aa3ad" strokeWidth="3" strokeLinecap="round" />)}</>;
        case "drizzle": return <><Cloud id={id} dy={-6} />{drops("#6fa8dc")}</>;
        case "rain": case "showers":
            return <>{sky === "showers" && <Sun id={id} x={20} y={16} r={8} />}<Cloud id={id} dark={sky === "rain"} dy={-6} />{drops("#2f7fd1")}</>;
        case "snow": case "snow-showers": return <><Cloud id={id} dy={-6} />{drops("", true)}</>;
        case "storm":
            return <><Cloud id={id} dark dy={-8} /><path d="M34 40l-8 12h6l-3 10 10-14h-6l4-8z" fill="#ffd21f" stroke="#b88600" strokeWidth="1" /></>;
        }
    })();
    return (
        <svg className={className} width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" data-sky={sky}>
            <defs>
                <radialGradient id={`${id}-sun`} cx="0.4" cy="0.35" r="0.7">
                    <stop offset="0" stopColor="#fff6b0" /><stop offset="0.6" stopColor="#ffd21f" /><stop offset="1" stopColor="#f5a300" />
                </radialGradient>
                <radialGradient id={`${id}-moon`} cx="0.4" cy="0.35" r="0.8">
                    <stop offset="0" stopColor="#ffffff" /><stop offset="1" stopColor="#c9d0dc" />
                </radialGradient>
                <linearGradient id={`${id}-cloud`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stopColor="#ffffff" /><stop offset="1" stopColor="#d3dae3" />
                </linearGradient>
                <linearGradient id={`${id}-dark`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stopColor="#b8c0ca" /><stop offset="1" stopColor="#7d8793" />
                </linearGradient>
            </defs>
            {body}
        </svg>
    );
}
