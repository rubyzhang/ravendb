﻿using System;
using System.Collections.Generic;
using Jint;
using Jint.Native.Function;
using Jint.Native.Object;
using Raven.Client;
using Raven.Client.Documents.Indexes;
using Raven.Server.Config;
using Raven.Server.Documents.Patch;

namespace Raven.Server.Documents.Indexes.Static.TimeSeries
{
    public sealed class TimeSeriesJavaScriptIndex : AbstractJavaScriptIndex
    {
        private const string MapPrefix = "timeSeries.";

        private const string NameProperty = "name";

        public TimeSeriesJavaScriptIndex(IndexDefinition definition, RavenConfiguration configuration)
            : base(definition, configuration)
        {
        }

        protected override string MapCode => @$"
function map() {{
    var collectionArg = null;
    var nameArg = null;
    var lambdaArg = null;

    if (arguments.length == 3) {{
        collectionArg = arguments[0];
        nameArg = arguments[1];
        lambdaArg = arguments[2];
    }} else if (arguments.length == 2) {{
        collectionArg = arguments[0];
        nameArg = '{Constants.TimeSeries.All}';
        lambdaArg = arguments[1];
    }} else if (arguments.length == 1) {{
        collectionArg = '{Constants.Documents.Collections.AllDocumentsCollection}';
        nameArg = '{Constants.TimeSeries.All}';
        lambdaArg = arguments[0];
    }}

    var map = {{
        collection: collectionArg,
        name: nameArg,
        method: lambdaArg,
        moreArgs: Array.prototype.slice.call(arguments, arguments.length)
    }};

    globalDefinition.maps.push(map);
}}";

        protected override List<string> GetMappingFunctions()
        {
            var maps = base.GetMappingFunctions();
            for (int i = 0; i < maps.Count; i++)
            {
                if (maps[i].StartsWith(MapPrefix, StringComparison.OrdinalIgnoreCase) == false)
                    continue;

                maps[i] = maps[i].Substring(MapPrefix.Length);
            }

            return maps;
        }

        protected override void OnInitializeEngine(Engine engine)
        {
        }

        protected override void ProcessMaps(ObjectInstance definitions, JintPreventResolvingTasksReferenceResolver resolver, List<string> mapList, List<MapMetadata> mapReferencedCollections, out Dictionary<string, Dictionary<string, List<JavaScriptMapOperation>>> collectionFunctions)
        {
            var mapsArray = definitions.GetProperty(MapsProperty).Value;
            if (mapsArray.IsNull() || mapsArray.IsUndefined() || mapsArray.IsArray() == false)
                ThrowIndexCreationException($"doesn't contain any map function or '{GlobalDefinitions}.{Maps}' was modified in the script");

            var maps = mapsArray.AsArray();
            if (maps.Length == 0)
                ThrowIndexCreationException($"doesn't contain any map functions or '{GlobalDefinitions}.{Maps}' was modified in the script");

            collectionFunctions = new Dictionary<string, Dictionary<string, List<JavaScriptMapOperation>>>();
            for (int i = 0; i < maps.Length; i++)
            {
                var mapObj = maps.Get(i.ToString());
                if (mapObj.IsNull() || mapObj.IsUndefined() || mapObj.IsObject() == false)
                    ThrowIndexCreationException($"map function #{i} is not a valid object");
                var map = mapObj.AsObject();
                if (map.HasProperty(CollectionProperty) == false)
                    ThrowIndexCreationException($"map function #{i} is missing a collection name");
                var mapCollectionStr = map.Get(CollectionProperty);
                if (mapCollectionStr.IsString() == false)
                    ThrowIndexCreationException($"map function #{i} collection name isn't a string");
                var mapCollection = mapCollectionStr.AsString();

                if (collectionFunctions.TryGetValue(mapCollection, out var subCollectionFunctions) == false)
                    collectionFunctions[mapCollection] = subCollectionFunctions = new Dictionary<string, List<JavaScriptMapOperation>>();

                if (map.HasProperty(NameProperty) == false)
                    ThrowIndexCreationException($"map function #{i} is missing its {NameProperty} property");
                var mapNameStr = map.Get(NameProperty);
                if (mapNameStr.IsString() == false)
                    ThrowIndexCreationException($"map function #{i} TimeSeries name isn't a string");
                var mapName = mapNameStr.AsString();

                if (subCollectionFunctions.TryGetValue(mapName, out var list) == false)
                    subCollectionFunctions[mapName] = list = new List<JavaScriptMapOperation>();

                if (map.HasProperty(MethodProperty) == false)
                    ThrowIndexCreationException($"map function #{i} is missing its {MethodProperty} property");
                var funcInstance = map.Get(MethodProperty).As<FunctionInstance>();
                if (funcInstance == null)
                    ThrowIndexCreationException($"map function #{i} {MethodProperty} property isn't a 'FunctionInstance'");
                var operation = new JavaScriptMapOperation(_engine, resolver)
                {
                    MapFunc = funcInstance,
                    IndexName = Definition.Name,
                    MapString = mapList[i]
                };
                if (map.HasOwnProperty(MoreArgsProperty))
                {
                    var moreArgsObj = map.Get(MoreArgsProperty);
                    if (moreArgsObj.IsArray())
                    {
                        var array = moreArgsObj.AsArray();
                        if (array.Length > 0)
                        {
                            operation.MoreArguments = array;
                        }
                    }
                }

                operation.Analyze(_engine);
                if (ReferencedCollections.TryGetValue(mapCollection, out var collectionNames) == false)
                {
                    collectionNames = new HashSet<CollectionName>();
                    ReferencedCollections.Add(mapCollection, collectionNames);
                }

                collectionNames.UnionWith(mapReferencedCollections[i].ReferencedCollections);

                if (mapReferencedCollections[i].HasCompareExchangeReferences)
                    CollectionsWithCompareExchangeReferences.Add(mapCollection);

                list.Add(operation);
            }
        }
    }
}
