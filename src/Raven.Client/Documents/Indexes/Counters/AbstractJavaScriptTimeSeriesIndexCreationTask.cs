﻿using System.Collections.Generic;

namespace Raven.Client.Documents.Indexes.Counters
{
    public class AbstractJavaScriptCountersIndexCreationTask : AbstractCountersIndexCreationTask
    {
        private readonly CountersIndexDefinition _definition = new CountersIndexDefinition();

        public AbstractJavaScriptCountersIndexCreationTask()
        {
            _definition.LockMode = IndexLockMode.Unlock;
            _definition.Priority = IndexPriority.Normal;
        }

        /// <summary>
        /// All the map functions for this index
        /// </summary>
        public HashSet<string> Maps
        {
            get => _definition.Maps;
            set => _definition.Maps = value;
        }

        public Dictionary<string, IndexFieldOptions> Fields
        {
            get => _definition.Fields;
            set => _definition.Fields = value;
        }

        protected string Reduce
        {
            get => _definition.Reduce;
            set => _definition.Reduce = value;
        }

        /// <inheritdoc />
        public override bool IsMapReduce => Reduce != null;

        /// <summary>
        /// If not null than each reduce result will be created as a document in the specified collection name.
        /// </summary>
        protected string OutputReduceToCollection
        {
            get => _definition.OutputReduceToCollection;
            set => _definition.OutputReduceToCollection = value;
        }

        /// <summary>
        /// Defines a collection name for reference documents created based on provided pattern
        /// </summary>
        protected string PatternReferencesCollectionName
        {
            get => _definition.PatternReferencesCollectionName;
            set => _definition.PatternReferencesCollectionName = value;
        }

        /// <summary>
        /// Defines a collection name for reference documents created based on provided pattern
        /// </summary>
        protected string PatternForOutputReduceToCollectionReferences
        {
            get => _definition.PatternForOutputReduceToCollectionReferences;
            set => _definition.PatternForOutputReduceToCollectionReferences = value;
        }

        /// <inheritdoc />
        public override CountersIndexDefinition CreateIndexDefinition()
        {
            _definition.Type = IsMapReduce ? IndexType.JavaScriptMapReduce : IndexType.JavaScriptMap;
            _definition.AdditionalSources = AdditionalSources ?? (_definition.AdditionalSources = new Dictionary<string, string>());
            _definition.Configuration = Configuration;

            var definition = new CountersIndexDefinition();
            _definition.CopyTo(definition);

            return definition;
        }
    }
}
