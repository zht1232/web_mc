package io.webcraft.bridge;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Minimal JSON reader/writer. Keeping this in the plugin avoids a runtime dependency on Gson or
 * SnakeYAML internals that Paper may relocate or hide from plugin classloaders.
 */
public final class Json {

    private static final int MAX_DEPTH = 32;

    private Json() {
    }

    public static Map<String, Object> parseObject(String text) {
        if (text == null) {
            throw new IllegalArgumentException("empty JSON");
        }
        Parser parser = new Parser(text);
        Object value = parser.parseValue(0);
        parser.skipWhitespace();
        if (!parser.atEnd()) {
            throw new IllegalArgumentException("trailing JSON data at index " + parser.index);
        }
        if (!(value instanceof Map<?, ?> map)) {
            throw new IllegalArgumentException("top-level JSON must be an object");
        }
        Map<String, Object> result = new LinkedHashMap<>();
        for (Map.Entry<?, ?> entry : map.entrySet()) {
            result.put(String.valueOf(entry.getKey()), entry.getValue());
        }
        return result;
    }

    public static String stringify(Object value) {
        StringBuilder builder = new StringBuilder(256);
        writeValue(builder, value);
        return builder.toString();
    }

    public static String quote(String value) {
        StringBuilder builder = new StringBuilder(value.length() + 2);
        writeString(builder, value);
        return builder.toString();
    }

    public static Map<String, Object> map(Object... keyValues) {
        if (keyValues.length % 2 != 0) {
            throw new IllegalArgumentException("map() needs key/value pairs");
        }
        Map<String, Object> result = new LinkedHashMap<>();
        for (int index = 0; index < keyValues.length; index += 2) {
            result.put(String.valueOf(keyValues[index]), keyValues[index + 1]);
        }
        return result;
    }

    public static List<Object> list(Object... values) {
        List<Object> result = new ArrayList<>(values.length);
        for (Object value : values) {
            result.add(value);
        }
        return result;
    }

    public static String str(Map<String, Object> object, String key) {
        Object value = object.get(key);
        return value instanceof String string ? string : null;
    }

    public static Double number(Map<String, Object> object, String key) {
        Object value = object.get(key);
        if (value instanceof Number number) {
            return number.doubleValue();
        }
        return null;
    }

    public static Integer integer(Map<String, Object> object, String key) {
        Double value = number(object, key);
        if (value == null || value.isNaN() || value.isInfinite()) {
            return null;
        }
        if (value < Integer.MIN_VALUE || value > Integer.MAX_VALUE) {
            return null;
        }
        return (int) Math.floor(value);
    }

    public static Boolean bool(Map<String, Object> object, String key) {
        Object value = object.get(key);
        return value instanceof Boolean bool ? bool : null;
    }

    @SuppressWarnings("unchecked")
    public static Map<String, Object> object(Map<String, Object> object, String key) {
        Object value = object.get(key);
        return value instanceof Map<?, ?> ? (Map<String, Object>) value : null;
    }

    public static void writeValue(StringBuilder builder, Object value) {
        if (value == null) {
            builder.append("null");
        } else if (value instanceof String string) {
            writeString(builder, string);
        } else if (value instanceof Boolean bool) {
            builder.append(bool);
        } else if (value instanceof Number number) {
            writeNumber(builder, number);
        } else if (value instanceof Map<?, ?> map) {
            builder.append('{');
            boolean first = true;
            for (Map.Entry<?, ?> entry : map.entrySet()) {
                if (!first) {
                    builder.append(',');
                }
                first = false;
                writeString(builder, String.valueOf(entry.getKey()));
                builder.append(':');
                writeValue(builder, entry.getValue());
            }
            builder.append('}');
        } else if (value instanceof Iterable<?> iterable) {
            builder.append('[');
            boolean first = true;
            for (Object element : iterable) {
                if (!first) {
                    builder.append(',');
                }
                first = false;
                writeValue(builder, element);
            }
            builder.append(']');
        } else if (value.getClass().isArray()) {
            builder.append('[');
            int length = java.lang.reflect.Array.getLength(value);
            for (int index = 0; index < length; index++) {
                if (index > 0) {
                    builder.append(',');
                }
                writeValue(builder, java.lang.reflect.Array.get(value, index));
            }
            builder.append(']');
        } else {
            writeString(builder, String.valueOf(value));
        }
    }

    private static void writeNumber(StringBuilder builder, Number number) {
        if (number instanceof Double doubleValue && (doubleValue.isNaN() || doubleValue.isInfinite())) {
            throw new IllegalArgumentException("non-finite JSON number");
        }
        if (number instanceof Float floatValue && (floatValue.isNaN() || floatValue.isInfinite())) {
            throw new IllegalArgumentException("non-finite JSON number");
        }
        builder.append(number);
    }

    private static void writeString(StringBuilder builder, String value) {
        builder.append('"');
        for (int index = 0; index < value.length(); index++) {
            char character = value.charAt(index);
            switch (character) {
                case '"' -> builder.append("\\\"");
                case '\\' -> builder.append("\\\\");
                case '\b' -> builder.append("\\b");
                case '\f' -> builder.append("\\f");
                case '\n' -> builder.append("\\n");
                case '\r' -> builder.append("\\r");
                case '\t' -> builder.append("\\t");
                default -> {
                    if (character < 0x20) {
                        builder.append(String.format("\\u%04x", (int) character));
                    } else {
                        builder.append(character);
                    }
                }
            }
        }
        builder.append('"');
    }

    private static final class Parser {
        private final String text;
        private int index;

        private Parser(String text) {
            this.text = text;
        }

        private Object parseValue(int depth) {
            if (depth > MAX_DEPTH) {
                throw error("JSON nesting too deep");
            }
            skipWhitespace();
            if (atEnd()) {
                throw error("unexpected end of JSON");
            }
            char character = text.charAt(index);
            return switch (character) {
                case '{' -> parseObject(depth);
                case '[' -> parseArray(depth);
                case '"' -> parseString();
                case 't' -> parseLiteral("true", Boolean.TRUE);
                case 'f' -> parseLiteral("false", Boolean.FALSE);
                case 'n' -> parseLiteral("null", null);
                default -> parseNumber();
            };
        }

        private Map<String, Object> parseObject(int depth) {
            expect('{');
            Map<String, Object> result = new LinkedHashMap<>();
            skipWhitespace();
            if (peek('}')) {
                index++;
                return result;
            }
            while (true) {
                skipWhitespace();
                if (!peek('"')) {
                    throw error("expected object key");
                }
                String key = parseString();
                skipWhitespace();
                expect(':');
                Object value = parseValue(depth + 1);
                result.put(key, value);
                skipWhitespace();
                if (peek('}')) {
                    index++;
                    return result;
                }
                expect(',');
            }
        }

        private List<Object> parseArray(int depth) {
            expect('[');
            List<Object> result = new ArrayList<>();
            skipWhitespace();
            if (peek(']')) {
                index++;
                return result;
            }
            while (true) {
                result.add(parseValue(depth + 1));
                skipWhitespace();
                if (peek(']')) {
                    index++;
                    return result;
                }
                expect(',');
            }
        }

        private String parseString() {
            expect('"');
            StringBuilder builder = new StringBuilder();
            while (index < text.length()) {
                char character = text.charAt(index++);
                if (character == '"') {
                    return builder.toString();
                }
                if (character == '\\') {
                    if (index >= text.length()) {
                        throw error("unterminated escape");
                    }
                    char escaped = text.charAt(index++);
                    switch (escaped) {
                        case '"' -> builder.append('"');
                        case '\\' -> builder.append('\\');
                        case '/' -> builder.append('/');
                        case 'b' -> builder.append('\b');
                        case 'f' -> builder.append('\f');
                        case 'n' -> builder.append('\n');
                        case 'r' -> builder.append('\r');
                        case 't' -> builder.append('\t');
                        case 'u' -> {
                            if (index + 4 > text.length()) {
                                throw error("bad unicode escape");
                            }
                            String hex = text.substring(index, index + 4);
                            try {
                                builder.append((char) Integer.parseInt(hex, 16));
                            } catch (NumberFormatException exception) {
                                throw error("bad unicode escape");
                            }
                            index += 4;
                        }
                        default -> throw error("bad escape \\" + escaped);
                    }
                } else {
                    if (character < 0x20) {
                        throw error("control character in string");
                    }
                    builder.append(character);
                }
            }
            throw error("unterminated string");
        }

        private Object parseNumber() {
            int start = index;
            if (peek('-')) {
                index++;
            }
            int digits = 0;
            while (index < text.length() && Character.isDigit(text.charAt(index))) {
                index++;
                digits++;
            }
            if (digits == 0) {
                throw error("invalid JSON value");
            }
            boolean decimal = false;
            if (peek('.')) {
                decimal = true;
                index++;
                int fractionDigits = 0;
                while (index < text.length() && Character.isDigit(text.charAt(index))) {
                    index++;
                    fractionDigits++;
                }
                if (fractionDigits == 0) {
                    throw error("invalid fraction");
                }
            }
            if (peek('e') || peek('E')) {
                decimal = true;
                index++;
                if (peek('+') || peek('-')) {
                    index++;
                }
                int exponentDigits = 0;
                while (index < text.length() && Character.isDigit(text.charAt(index))) {
                    index++;
                    exponentDigits++;
                }
                if (exponentDigits == 0) {
                    throw error("invalid exponent");
                }
            }
            String number = text.substring(start, index);
            try {
                if (!decimal) {
                    return Long.parseLong(number);
                }
                return Double.parseDouble(number);
            } catch (NumberFormatException exception) {
                throw error("number out of range");
            }
        }

        private Object parseLiteral(String literal, Object value) {
            if (!text.startsWith(literal, index)) {
                throw error("invalid literal");
            }
            index += literal.length();
            return value;
        }

        private void expect(char expected) {
            skipWhitespace();
            if (index >= text.length() || text.charAt(index) != expected) {
                throw error("expected '" + expected + "'");
            }
            index++;
        }

        private boolean peek(char character) {
            return index < text.length() && text.charAt(index) == character;
        }

        private void skipWhitespace() {
            while (index < text.length()) {
                char character = text.charAt(index);
                if (character == ' ' || character == '\n' || character == '\r' || character == '\t') {
                    index++;
                } else {
                    break;
                }
            }
        }

        private boolean atEnd() {
            return index >= text.length();
        }

        private IllegalArgumentException error(String message) {
            return new IllegalArgumentException(message + " at index " + index);
        }
    }
}
