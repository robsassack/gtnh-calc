using System.Buffers;
using System.Diagnostics;

namespace Source
{
    public class DatabaseParser
    {
        public T[] GetTableContents<T>(TypeSchema<T> schema)
        {
            var tableName = schema.tableName;
            Console.WriteLine("Processing " + tableName);
            if (tables.TryGetValue(tableName, out var table))
                return schema.ToTypedArray(table.elements);
            return Array.Empty<T>();
        }

        public T[] ConsumeTableContents<T>(TypeSchema<T> schema)
        {
            var tableName = schema.tableName;
            Console.WriteLine("Processing " + tableName);
            if (!tables.Remove(tableName, out var table))
                return Array.Empty<T>();
            return schema.ToTypedArray(table.elements);
        }

        private readonly Dictionary<string, Table> tables = new Dictionary<string, Table>();

        public void Parse(string databaseFile)
        {
            using var fs = File.OpenRead(databaseFile);
            using var fileReader = new StreamReader(fs);
            var lineNumber = 0;
            while (true)
            {
                var line = fileReader.ReadLine();
                if (line == null)
                    break;
                if ((lineNumber++ & 0xFFF) == 0)
                    Console.WriteLine("Parsing line "+ lineNumber.ToString() + " ["+(10000 * fs.Position / fs.Length)/100.0+"%]");
                var reader = new SqlLineReader(line);
                if (!reader.ReadToken(out var first))
                    continue;
                if (first.Match("CREATE"))
                    CreateTable(ref reader);
                else if (first.Match("INSERT"))
                    InsertInto(ref reader);
            }
            Console.WriteLine("Parsing complte ("+lineNumber+" lines parsed)");
        }

        private void CreateTable(ref SqlLineReader reader)
        {
            if (!reader.ReadToken(out var token))
                return;
            if (token.Match("MEMORY") && !reader.ReadToken(out token))
                return;
            if (!token.Match("TABLE") || !reader.ReadToken(out token))
                return;
            var name = token.ToString();
            if (!name.StartsWith("PUBLIC."))
                return;
            name = name.Substring("PUBLIC.".Length);
            var schema = PackConverter.FindSchema(name);
            if (schema == null)
                return;
            var fieldsBuilder = new List<ReadOnlySpanAction<char, object>>();
            if (!reader.ReadToken(out token) || !token.Match('('))
                return;
            while (true)
            {
                if (!reader.ReadToken(out token))
                    return;
                if (token.isIdentifier)
                {
                    var fieldName = token.ToString();
                    if (fieldName != "CONSTRAINT")
                        fieldsBuilder.Add(schema.GetSetter(fieldName));
                    var depth = 0;
                    while (reader.ReadToken(out token))
                    {
                        if (token.isIdentifier)
                            continue;
                        var c = token.character;
                        if (c == ',')
                            break;
                        if (c == '(')
                            depth++;
                        if (c == ')')
                        {
                            if (depth > 0)
                                depth--;
                            else
                            {
                                tables[name] = new Table(schema.GetConstructor(), fieldsBuilder.ToArray());
                                return;
                            }
                        }
                    }
                }
            }
        }

        private void InsertInto(ref SqlLineReader reader)
        {
            if (!reader.ReadToken(out var token) || !token.Match("INTO"))
                return;
            if (!reader.ReadToken(out token))
                return;
            var tableName = token.ToString();
            if (!tables.TryGetValue(tableName, out var table))
                return;
            if (!reader.ReadToken(out token) || !token.Match("VALUES"))
                return;
            if (!reader.ReadToken(out token) || !token.Match('('))
                return;
            var index = 0;
            var obj = table.Create();
            while (true)
            {
                if (!reader.ReadToken(out token))
                    return;
                var span = token.Match('\'') ? reader.ReadEscapedString() : token.chars;
                table.Set(obj, index, span);
                index++;
                if (!reader.ReadToken(out token) || !token.Match(','))
                    return;
            }
        }
        
        private ref struct SqlLineReader
        {
            private ReadOnlySpan<char> chars;
            public SqlLineReader(ReadOnlySpan<char> chars)
            {
                this.chars = chars;
            }

            public ReadOnlySpan<char> ReadEscapedString()
            {
                var next = chars.IndexOf('\'');
                if (next == -1)
                    return default;
                var isEscaped = chars.Length > next + 1 && chars[next+1] == '\'';
                if (!isEscaped)
                {
                    var str = chars.Slice(0, next);
                    chars = chars.Slice(next + 1);
                    return str;
                }

                var segment = chars.Slice(0, next + 1).ToString();
                chars = chars.Slice(next + 2);
                return segment + ReadEscapedString().ToString();
            }

            public bool ReadToken(out SqlToken token)
            {
                var index = 0;
                for (; index < chars.Length; index++)
                {
                    if (chars[index] != ' ')
                        break;
                }

                var start = index;

                if (index < chars.Length)
                {
                    var first = chars[index];
                    index++;
                    if (char.IsLetterOrDigit(first) || first == '-' || first == '_')
                    {
                        for (; index < chars.Length; index++)
                        {
                            var c = chars[index];
                            if (!char.IsLetterOrDigit(c) && c != '.' && c != '_' && c != '+' && c != '-')
                                break;
                        }

                        token = new SqlToken(chars.Slice(start, index - start), true);
                    }
                    else
                    {
                        token = new SqlToken(chars.Slice(start, 1), false);
                    }

                    chars = chars.Slice(index);
                    return true;
                }

                token = default;
                return false;
            }
        }
        
        private readonly ref struct SqlToken
        {
            public readonly ReadOnlySpan<char> chars;
            public readonly bool isIdentifier;

            public SqlToken(ReadOnlySpan<char> chars, bool isIdentifier)
            {
                this.chars = chars;
                this.isIdentifier = isIdentifier;
            }

            public bool Match(string data)
            {
                return chars.SequenceEqual(data);
            }

            public bool Match(char data)
            {
                return !isIdentifier && chars[0] == data;
            }

            public char character => isIdentifier ? (char)0 : chars[0];

            public override string ToString() => chars.ToString();
        }

        private class Table
        {
            public readonly List<object> elements = new List<object>();
            private readonly Func<object> constructor;
            private readonly ReadOnlySpanAction<char, object>[] setters;

            public Table(Func<object> constructor, ReadOnlySpanAction<char, object>[] setters)
            {
                this.constructor = constructor;
                this.setters = setters;
            }

            public object Create()
            {
                var obj = constructor();
                elements.Add(obj);
                return obj;
            }

            public void Set(object obj, int index, ReadOnlySpan<char> chars)
            {
                if (setters.Length <= index)
                    return;
                var setter = setters[index];
                if (setter == null)
                    return;
                setter(chars, obj);
            }
        }
    }
}
