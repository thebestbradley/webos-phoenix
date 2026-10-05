// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0

#include "json.h"

#include <cstdio>
#include <cstdlib>
#include <cstring>

namespace phoenix {

std::string jsonQuote(const std::string &s)
{
    std::string out;
    out.reserve(s.size() + 2);
    out += '"';
    for (unsigned char c : s) {
        switch (c) {
        case '"': out += "\\\""; break;
        case '\\': out += "\\\\"; break;
        case '\n': out += "\\n"; break;
        case '\r': out += "\\r"; break;
        case '\t': out += "\\t"; break;
        case '\b': out += "\\b"; break;
        case '\f': out += "\\f"; break;
        default:
            if (c < 0x20 || c == 0x7F) {
                char esc[8];
                std::snprintf(esc, sizeof esc, "\\u%04x", c);
                out += esc;
            } else {
                out += static_cast<char>(c);
            }
        }
    }
    out += '"';
    return out;
}

class JsonParser
{
public:
    explicit JsonParser(const std::string &t) : s(t) {}

    bool parse(Json &out)
    {
        if (!value(out, 0))
            return false;
        ws();
        return i == s.size();
    }

private:
    const std::string &s;
    size_t i = 0;

    void ws()
    {
        while (i < s.size() && (s[i] == ' ' || s[i] == '\t' || s[i] == '\n' || s[i] == '\r'))
            ++i;
    }

    bool literal(const char *word)
    {
        const size_t n = std::strlen(word);
        if (s.compare(i, n, word) != 0)
            return false;
        i += n;
        return true;
    }

    static void append(std::string &out, unsigned cp)
    {
        if (cp < 0x80) {
            out += static_cast<char>(cp);
        } else if (cp < 0x800) {
            out += static_cast<char>(0xC0 | (cp >> 6));
            out += static_cast<char>(0x80 | (cp & 0x3F));
        } else if (cp < 0x10000) {
            out += static_cast<char>(0xE0 | (cp >> 12));
            out += static_cast<char>(0x80 | ((cp >> 6) & 0x3F));
            out += static_cast<char>(0x80 | (cp & 0x3F));
        } else {
            out += static_cast<char>(0xF0 | (cp >> 18));
            out += static_cast<char>(0x80 | ((cp >> 12) & 0x3F));
            out += static_cast<char>(0x80 | ((cp >> 6) & 0x3F));
            out += static_cast<char>(0x80 | (cp & 0x3F));
        }
    }

    bool hex4(unsigned &v)
    {
        if (i + 4 > s.size())
            return false;
        v = 0;
        for (int k = 0; k < 4; ++k) {
            const char c = s[i++];
            v <<= 4;
            if (c >= '0' && c <= '9') v |= c - '0';
            else if (c >= 'a' && c <= 'f') v |= c - 'a' + 10;
            else if (c >= 'A' && c <= 'F') v |= c - 'A' + 10;
            else return false;
        }
        return true;
    }

    bool string(std::string &out)
    {
        if (i >= s.size() || s[i] != '"')
            return false;
        ++i;
        while (i < s.size()) {
            const char c = s[i++];
            if (c == '"')
                return true;
            if (static_cast<unsigned char>(c) < 0x20)
                return false;
            if (c != '\\') {
                out += c;
                continue;
            }
            if (i >= s.size())
                return false;
            const char e = s[i++];
            switch (e) {
            case '"': out += '"'; break;
            case '\\': out += '\\'; break;
            case '/': out += '/'; break;
            case 'b': out += '\b'; break;
            case 'f': out += '\f'; break;
            case 'n': out += '\n'; break;
            case 'r': out += '\r'; break;
            case 't': out += '\t'; break;
            case 'u': {
                unsigned cp;
                if (!hex4(cp))
                    return false;
                if (cp >= 0xD800 && cp <= 0xDBFF && i + 1 < s.size() && s[i] == '\\' && s[i + 1] == 'u') {
                    const size_t save = i;
                    i += 2;
                    unsigned lo;
                    if (hex4(lo) && lo >= 0xDC00 && lo <= 0xDFFF)
                        cp = 0x10000 + ((cp - 0xD800) << 10) + (lo - 0xDC00);
                    else
                        i = save;
                }
                if (cp >= 0xD800 && cp <= 0xDFFF)
                    cp = 0xFFFD;   // a lone surrogate
                append(out, cp);
                break;
            }
            default:
                return false;
            }
        }
        return false;
    }

    bool value(Json &out, int depth)
    {
        if (depth > 32)
            return false;
        ws();
        if (i >= s.size())
            return false;
        const char c = s[i];
        if (c == '{') {
            ++i;
            out.m_type = Json::Object;
            ws();
            if (i < s.size() && s[i] == '}') { ++i; return true; }
            for (;;) {
                ws();
                std::string key;
                if (!string(key))
                    return false;
                ws();
                if (i >= s.size() || s[i] != ':')
                    return false;
                ++i;
                Json v;
                if (!value(v, depth + 1))
                    return false;
                out.m_members.emplace_back(std::move(key), std::move(v));
                ws();
                if (i < s.size() && s[i] == ',') { ++i; continue; }
                if (i < s.size() && s[i] == '}') { ++i; return true; }
                return false;
            }
        }
        if (c == '[') {
            ++i;
            out.m_type = Json::Array;
            ws();
            if (i < s.size() && s[i] == ']') { ++i; return true; }
            for (;;) {
                Json v;
                if (!value(v, depth + 1))
                    return false;
                out.m_items.push_back(std::move(v));
                ws();
                if (i < s.size() && s[i] == ',') { ++i; continue; }
                if (i < s.size() && s[i] == ']') { ++i; return true; }
                return false;
            }
        }
        if (c == '"') {
            out.m_type = Json::String;
            return string(out.m_str);
        }
        if (literal("true")) { out.m_type = Json::Bool; out.m_bool = true; return true; }
        if (literal("false")) { out.m_type = Json::Bool; out.m_bool = false; return true; }
        if (literal("null")) { out.m_type = Json::Null; return true; }
        if (c == '-' || (c >= '0' && c <= '9')) {
            const char *start = s.c_str() + i;
            char *end = nullptr;
            const double d = std::strtod(start, &end);
            if (end == start)
                return false;
            i += static_cast<size_t>(end - start);
            out.m_type = Json::Number;
            out.m_num = d;
            return true;
        }
        return false;
    }
};

Json Json::parse(const std::string &text, bool *ok)
{
    Json out;
    JsonParser p(text);
    const bool good = p.parse(out);
    if (ok)
        *ok = good;
    return good ? out : Json();
}

const Json &Json::operator[](const std::string &key) const
{
    static const Json null;
    for (const auto &m : m_members)
        if (m.first == key)
            return m.second;
    return null;
}

bool Json::has(const std::string &key) const
{
    for (const auto &m : m_members)
        if (m.first == key)
            return true;
    return false;
}

} // namespace phoenix
