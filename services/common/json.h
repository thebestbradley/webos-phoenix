// Copyright (c) 2026 webOS Phoenix contributors
// SPDX-License-Identifier: Apache-2.0
//
// The JSON the Phoenix services read and write on the bus: a small reader
// and string quoting, shared by org.webosphoenix.pty (services/pty) and
// phoenix-devices (services/devices).

#pragma once

#include <string>
#include <utility>
#include <vector>

namespace phoenix {

std::string jsonQuote(const std::string &utf8);

// A small JSON reader: objects, arrays, strings (with \u escapes and
// surrogate pairs), numbers, true/false/null.
class Json
{
public:
    enum Type { Null, Bool, Number, String, Array, Object };
    Json() = default;

    static Json parse(const std::string &text, bool *ok = nullptr);

    Type type() const { return m_type; }
    bool isNull() const { return m_type == Null; }
    bool isString() const { return m_type == String; }
    bool isNumber() const { return m_type == Number; }
    bool isBool() const { return m_type == Bool; }
    bool isObject() const { return m_type == Object; }
    bool isArray() const { return m_type == Array; }

    // Members of an object; a missing one is Null.
    const Json &operator[](const std::string &key) const;
    bool has(const std::string &key) const;

    std::string str(const std::string &fallback = std::string()) const { return m_type == String ? m_str : fallback; }
    double num(double fallback = 0) const { return m_type == Number ? m_num : fallback; }
    bool boolean(bool fallback = false) const { return m_type == Bool ? m_bool : fallback; }
    const std::vector<Json> &items() const { return m_items; }

private:
    friend class JsonParser;
    Type m_type = Null;
    bool m_bool = false;
    double m_num = 0;
    std::string m_str;
    std::vector<Json> m_items;
    std::vector<std::pair<std::string, Json>> m_members;
};

} // namespace phoenix
