/// <reference path="../../Scripts/typings/d3/dagre.d.ts" />

import viewModelBase = require("viewmodels/viewModelBase");
import getReplicationStatsCommand = require("commands/getReplicationStatsCommand");
import moment = require("moment");
import generalUtils = require("common/generalUtils");
import svgDownloader = require("common/svgDownloader");
import fileDownloader = require("common/fileDownloader");
import getDatabaseSettingsCommand = require("commands/getDatabaseSettingsCommand");
import getReplicationTopology = require("commands/getReplicationTopology");
import getReplicationPerfStatsCommand = require("commands/getReplicationPerfStatsCommand");
import d3 = require('d3/d3');
import nv = require('nvd3');
import dagre = require('dagre');

class replicationStats extends viewModelBase {

    panelBodyPadding = 20;

    topology = ko.observable<replicationTopologyDto>(null);
    currentLink = ko.observable<replicationTopologyConnectionDto>(null);

    hasReplicationEnabled = ko.observable(false); 

    showLoadingIndicator = ko.observable(false); 
    replStatsDoc = ko.observable<replicationStatsDocumentDto>();
    hasNoReplStatsAvailable = ko.observable(false);
    now = ko.observable<Moment>();
    updateNowTimeoutHandle = 0;

    width: number;
    height: number;
    svg: D3.Selection;
    colors = d3.scale.category10();
    line = d3.svg.line().x(d => d.x).y(d => d.y);


    // perf stats related variables start
    jsonData: any[] = [];
    rawJsonData: any[] = [];
    hiddenNames = d3.set([]);
    destinations: string[] = [];

    margin = { top: 40, right: 20, bottom: 20, left: 40 };
    barWidth = 30;
    perfWidth: number;
    perfHeight: number;
    barPadding = 15;
    legendWidth = 0;
    isoFormat = d3.time.format.iso;
    xTickFormat = d3.time.format("%H:%M:%S");
    x0Scale: D3.Scale.OrdinalScale;
    yScale: D3.Scale.LinearScale;
    color = d3.scale.category20();
    xAxis: D3.Svg.Axis;
    yAxis: D3.Svg.Axis;
    perfSvg: D3.Selection;
    legend: D3.UpdateSelection;
    // perf stats related variables end


    hasSaveAsPngSupport = ko.computed(() => {
        return !(navigator && navigator.msSaveBlob);
    });


    constructor() {
        super();

        this.updateCurrentNowTime();
    }

    activate(args) {
        super.activate(args);

        this.activeDatabase.subscribe(() => {
            this.fetchReplStats();
            this.checkIfHasReplicationEnabled();
        });
        this.fetchReplStats();
    }

    checkIfHasReplicationEnabled() {
        new getDatabaseSettingsCommand(this.activeDatabase())
            .execute()
            .done(document => {
                var documentSettings = document.Settings["Raven/ActiveBundles"];
                this.hasReplicationEnabled(documentSettings.indexOf("Replication") !== -1);
            });
    }

    attached() {
        this.resize();
        d3.select(window).on("resize", this.resize.bind(this));
        $("#replicationTopologySection").scroll(() => this.graphScrolled());
        this.checkIfHasReplicationEnabled();
        $("#replicationStatsContainer").scroll(() => this.graphScrolled());
        this.refresh();
    }

    resize() {
        this.width = $("#replicationTopologySection").width() * 0.6;
        this.onWindowHeightChanged();
    }

    fetchReplStats() {
        this.replStatsDoc(null);
        new getReplicationStatsCommand(this.activeDatabase())
            .execute()
            .fail(() => this.hasNoReplStatsAvailable(true)) // If replication is not setup, the fetch will fail with 404.
            .done((result: replicationStatsDocumentDto) => {
                this.hasNoReplStatsAvailable(result.Stats.length === 0);
                this.processResults(result);
            });
    }

    processResults(results: replicationStatsDocumentDto) {
        if (results) {
            results.Stats.forEach(s => {
                s['LastReplicatedLastModifiedHumanized'] = this.createHumanReadableTime(s.LastReplicatedLastModified);
                s['LastFailureTimestampHumanized'] = this.createHumanReadableTime(s.LastFailureTimestamp);
                s['LastHeartbeatReceivedHumanized'] = this.createHumanReadableTime(s.LastHeartbeatReceived);
                s['LastSuccessTimestampHumanized'] = this.createHumanReadableTime(s.LastSuccessTimestamp);
                s['isHotFailure'] = this.isFailEarlierThanSuccess(s.LastFailureTimestamp, s.LastSuccessTimestamp);
            });
        }

        this.replStatsDoc(results);
    }

    createHumanReadableTime(time: string): KnockoutComputed<string> {
        if (time) {
            // Return a computed that returns a humanized string based off the current time, e.g. "7 minutes ago".
            // It's a computed so that it updates whenever we update this.now (scheduled to occur every minute.)
            return ko.computed(() => {
                var dateMoment = moment(time);
                var agoInMs = dateMoment.diff(this.now());
                return moment.duration(agoInMs).humanize(true) + dateMoment.format(" (MM/DD/YY, h:mma)");
            });
        }

        return ko.computed(() => time);
    }


    isFailEarlierThanSuccess(lastFailureTime: string, lastSuccessTime:string): boolean {
        if (!!lastFailureTime) {
            if (!!lastSuccessTime) {
                return lastFailureTime >= lastSuccessTime;
            } else {
                return true;
            }
        }

        return false;
    }

    updateCurrentNowTime() {
        this.now(moment());
        this.updateNowTimeoutHandle = setTimeout(() => this.updateCurrentNowTime(), 60000);
    }

    createReplicationTopology() {
        var self = this;

        this.height = 600;

        this.svg = d3.select("#replicationTopology")
            .style({ height: self.height + 'px' })
            .style({ width: self.width + 'px' })
            .attr("viewBox", "0 0 " + self.width + " " + self.height);

        var nodes = this.topology().Servers;

        var topologyGraph = new dagre.graphlib.Graph();
        topologyGraph.setGraph({});
        topologyGraph.setDefaultEdgeLabel(() => "");

        this.topology().Servers.forEach(s => {
            topologyGraph.setNode(s, {
                id: s,
                width: 200,
                height: 40
            });
        });

        this.topology().Connections.forEach(c => {
            topologyGraph.setEdge(c.Source, c.Destination, c);
        });

        dagre.layout(topologyGraph);
        this.renderTopology(topologyGraph);
    }

    linkWithArrow(d) {
        var self = this;
        var pointCount = d.points.length;
        var 
            d90 = Math.PI / 2,
            sourceX = d.points[pointCount-2].x,
            sourceY = d.points[pointCount-2].y,
            targetX = d.points[pointCount-1].x,
            targetY = d.points[pointCount-1].y;

        var theta = Math.atan2(targetY - sourceY, targetX - sourceX);

        return self.line(d.points) +
            "M" + targetX + "," + targetY +
            "l" + (3.5 * Math.cos(d90 - theta) - 10 * Math.cos(theta)) + "," + (-3.5 * Math.sin(d90 - theta) - 10 * Math.sin(theta)) +
            "L" + (targetX - 3.5 * Math.cos(d90 - theta) - 10 * Math.cos(theta)) + "," + (targetY + 3.5 * Math.sin(d90 - theta) - 10 * Math.sin(theta)) + "z";
    }

    linkHasError(d: replicationTopologyConnectionDto) {
        return d.SourceToDestinationState !== "Online";
    }

    renderTopology(topologyGraph) {
        var self = this;

        var enteringGraph = this.svg.selectAll('.graph').data([null]).enter().append('g').attr('class', 'graph');
        enteringGraph.append('g').attr('class', 'nodes');
        enteringGraph.append('g').attr('class', 'edges');

        enteringGraph.attr('transform', 'translate(' + ((self.width - topologyGraph.graph().width) / 2) + ',10)');

        var mappedNodes = topologyGraph.nodes().map(n => topologyGraph.node(n));

        var nodesDom = this.svg.select('.nodes').selectAll('.node').data(mappedNodes, d => d.id);

        var nGroup = nodesDom.enter()
            .append('g')
            .attr('class', 'node')
            .attr('transform', d => 'translate(' + d.x + ',' + d.y + ')');

        nGroup.append('svg:rect')
            .attr('class', 'node')
            .attr('rx', 5)
            .attr("x", -100)
            .attr("y", -20)
            .attr('width', 200)
            .attr('height', 40);

        nGroup.append('svg:text')
            .attr('x', 0)
            .attr('y', -4)
            .attr('class', 'id')
            .text(d => d.id.split("/databases/")[0]);

        nGroup.append('svg:text')
            .attr('x', 0)
            .attr('y', 14)
            .attr('class', 'id')
            .text(d => d.id.split("/databases/")[1]);

        var mappedEdges = topologyGraph.edges().map(e => topologyGraph.edge(e));

        var edgesDom = this.svg.select('.edges').selectAll('.edge').data(mappedEdges, d => d.Source + "_" + d.Destination);

        edgesDom.enter()
            .append('path')
            .attr('class', 'link')
            .classed('error', self.linkHasError)
            .attr('d', d => self.linkWithArrow(d))
            .on("click", function (d) {
                var currentSelection = d3.select(".selected").node();
                d3.selectAll(".selected").classed("selected", false);
                d3.select(this).classed('selected', currentSelection != this);
                self.currentLink(currentSelection != this ? d : null)
             });
    }


    fetchTopology() {
        this.showLoadingIndicator(true);
        new getReplicationTopology(this.activeDatabase())
            .execute()
            .done((topo) => {
                this.topology(topo); 
                this.createReplicationTopology();
                $("#replicationSetupCollapse").addClass("in"); // Force the panel to expand. Fixes a bug where the panel collapses when we fill it with content.
            })
            .always(() => this.showLoadingIndicator(false)); 
    }

    saveAsPng() {
        svgDownloader.downloadPng(d3.select('#replicationTopology').node(), 'replicationTopology.png', svgDownloader.extractInlineCss);
    }

    saveAsSvg() {
        svgDownloader.downloadSvg(d3.select('#replicationTopology').node(), 'replicationTopology.svg', svgDownloader.extractInlineCss);
    }

    saveAsJson() {
        fileDownloader.downloadAsJson(this.topology(), "topology.json");
    }


    fetchJsonData() {
        return new getReplicationPerfStatsCommand(this.activeDatabase()).execute();
    }

    modelPolling() {
        // don't pool if unable to locate element
        var container = $("#replicationStatsContainer");
        if (container.length > 0) {
            return this.refresh();
        }
        return $.Deferred().resolve();
    }

    filterJsonData() {
        this.jsonData = [];

        this.rawJsonData.forEach(v => {
            var filteredStats = v.Stats.filter(s => !this.hiddenNames.has(s.Destination));
            if (filteredStats.length > 0) {
                this.jsonData.push({
                    'Started': v.Started,
                    'Stats': filteredStats
                });
            }
        });
    }

    refresh() {
        return this.fetchJsonData().done((data) => {
            this.rawJsonData = this.mergeJsonData(this.rawJsonData, data);
            this.destinations = this.findDestinations(this.rawJsonData);
            this.filterJsonData();
            this.redrawGraph();
        });
    }

    private mergeJsonData(currentData: any[], incomingData: any[]) {
        // create lookup map to avoid O(n^2) 
        var dateLookup = d3.map();
        currentData.forEach((d, i) => {
            dateLookup.set(d.Started, i);
        });

        incomingData.forEach(d => {
            if (dateLookup.has(d.Started)) {
                var index = dateLookup.get(d.Started);
                currentData[index] = d;
            } else {
                currentData.push(d);
            }
        });
        return currentData;
    }

    private computeBarWidths(data: any[]) {
        var cumulative = 10;
        var result = data.map(perfData => {
            var prevValue = cumulative;
            perfData.sectionWidth = perfData.Stats.length * this.barWidth + this.barPadding * 2;
            cumulative += perfData.sectionWidth;
            return prevValue;
        });
        result.push(cumulative);
        return result;
    }

    graphScrolled() {
        var leftScroll = $("#replicationStatsContainer").scrollLeft();
        var self = this;
        this.perfSvg.select('.y.axis')
            .attr("transform", "translate(" + leftScroll + ",0)");

        this.perfSvg.select('#dataClip rect')
            .attr('x', leftScroll);

        this.perfSvg.select('.legend_bg_group')
            .attr("transform", "translate(" + leftScroll + ",0)");

        this.perfSvg.select('.controlls')
            .selectAll(".legend")
            .attr("transform", function (d, i) { return "translate(" + leftScroll + "," + i * 20 + ")"; });
        nv.tooltip.cleanup();
    }

    toggleGroupVisible(groupName) {
        nv.tooltip.cleanup();
        var alreadyHidden = this.hiddenNames.has(groupName);
        if (alreadyHidden) {
            this.hiddenNames.remove(groupName);
        } else {
            this.hiddenNames.add(groupName);
        }
        d3.select('.rect-legend-' + generalUtils.escape(groupName)).classed('legendHidden', !alreadyHidden);
        this.filterJsonData();
        this.redrawGraph();
        // we have to manually trigger on scroll even to fix firefox issue (missing event call)
        this.graphScrolled();
    }

    redrawGraph() {
        var self = this;

        this.perfWidth = $("#replicationTopologySection").width() - this.panelBodyPadding * 2 - this.margin.left - this.margin.right;
        this.perfHeight = $("#replicationStatsContainer").height() - this.margin.top - this.margin.bottom - 20; // substract scroll width

        var cumulativeWidths = this.computeBarWidths(this.jsonData);

        this.x0Scale = d3.scale.ordinal().range(cumulativeWidths);
        this.yScale = d3.scale.linear().range([self.perfHeight, 0]);
        this.xAxis = d3.svg.axis()
            .scale(self.x0Scale)
            .orient("bottom")
            .tickFormat(d => "")
            .tickPadding(20);
        this.yAxis = d3.svg.axis()
            .scale(self.yScale)
            .orient("left")
            .tickFormat(d3.format(".2s"));

        var totalHeight = self.perfHeight + self.margin.top + self.margin.bottom;

        // get higer value from total (visiable and not visible graph width) and viewbox width.
        var totalWidth = Math.max(cumulativeWidths[cumulativeWidths.length - 1], this.perfWidth) + this.margin.left + this.margin.right;

        $("#replicationStatsContainer").css('overflow-x', cumulativeWidths[cumulativeWidths.length - 1] > this.perfWidth ? 'scroll' : 'hidden');

        this.perfSvg = d3.select("#replicationStatsGraph")
            .attr("width", totalWidth)
            .attr("height", totalHeight)
            .style({ height: totalHeight + 'px' })
            .style({ width: totalWidth + 'px' })
            .attr("viewBox", "0 0 " + totalWidth + " " + totalHeight);

        this.perfSvg.selectAll('.main_group')
            .attr("transform", "translate(" + self.margin.left + "," + self.margin.top + ")");

        this.perfSvg
            .selectAll('defs')
            .data([this.jsonData])
            .enter()
            .append('defs')
            .append('clipPath')
            .attr('id', 'dataClip')
            .append('rect')
            .attr('x', 0)
            .attr('y', 0)
            .attr('width', 1200000)
            .attr('height', 50000);

        var svgEnter = this.perfSvg
            .selectAll(".main_group")
            .data([this.jsonData]).enter();

        svgEnter.append('g')
            .attr('class', 'main_group')
            .attr('clip-path', "url(#dataClip)")
            .attr("transform", "translate(" + self.margin.left + "," + self.margin.top + ")");

        var controllsEnter = this.perfSvg
            .selectAll(".controlls")
            .data([this.jsonData]).enter()
            .append("g")
            .attr('class', 'controlls')
            .attr("transform", "translate(" + self.margin.left + "," + self.margin.top + ")");

        controllsEnter.append("g")
            .attr("class", "x axis");

        controllsEnter.append('g')
            .attr('class', 'y axis')

        controllsEnter.append('g')
            .attr('class', 'legend_bg_group')
            .append('rect')
            .attr('class', 'legend_bg')
            .attr('x', self.perfWidth)
            .attr('y', 0)
            .attr('width', 0)
            .attr('height', 0);

        controllsEnter.select('.y.axis')
            .append("text")
            .attr("transform", "rotate(-90)")
            .attr("y", 6)
            .attr("dy", ".71em")
            .style("text-anchor", "end")
            .text("Batch size");

        this.x0Scale.domain(d3.nest()
            .key(d => d.Started)
            .sortKeys(d3.ascending)
            .entries(self.jsonData)
            .map(d => d.key));

        this.yScale.domain([0, d3.max(this.jsonData, d => d3.max(<any[]>d.Stats, dd => dd.BatchSize))]);

        this.perfSvg.select(".x.axis")
            .attr('clip-path', "url(#dataClip)")
            .attr("transform", "translate(0," + self.perfHeight + ")")
            .transition()
            .call(self.xAxis);

        this.perfSvg.select('.y.axis')
            .transition()
            .call(self.yAxis);

        var frame = this.perfSvg.select('.main_group').selectAll(".frame")
            .data(self.jsonData, d => d.Started);

        frame.exit().remove();

        frame
            .transition()
            .attr("transform", d => "translate(" + self.x0Scale(d.Started) + ",0)");

        frame
            .select('.date_tick')
            .transition()
            .attr('x', d => d.sectionWidth / 2)
            .attr('y', self.perfHeight + 16);

        var frameEnter = frame.enter()
            .append("g")
            .attr("class", "frame")
            .attr("transform", d => "translate(" + self.x0Scale(d.Started) + ",0)");

        frameEnter.append("text")
            .attr('class', 'date_tick')
            .attr('text-anchor', 'middle')
            .attr('x', d => d.sectionWidth / 2)
            .attr('y', self.perfHeight + 16)
            .text(d => self.xTickFormat(self.isoFormat.parse(d.Started)));

        frameEnter.append("g")
            .attr('class', 'inputs');

        var inputCounts = frame.select('.inputs').selectAll(".inputCounts")
            .data(d => d.Stats, d => d.Destination);

        inputCounts.exit().remove();

        inputCounts
            .transition()
            .attr("width", self.barWidth)
            .attr("x", (d, i) => i * self.barWidth + self.barPadding)
            .attr("y", d => self.yScale(d.BatchSize))
            .attr("height", d => self.perfHeight - self.yScale(d.BatchSize))
            .style("fill", d => self.color(d.Destination));

        inputCounts.enter().append("rect")
            .attr("class", "inputCounts")
            .attr("width", self.barWidth)
            .attr("x", (d, i) => i * self.barWidth + self.barPadding)
            .attr("y", d => self.perfHeight)
            .attr("height", 0)
            .style("fill", d => self.color(d.Destination))
            .on('click', function (d) {
                nv.tooltip.cleanup();
                var offset = $(this).offset();
                var leftScroll = $("#replicationStatsContainer").scrollLeft();
                var containerOffset = $("#replicationTopologySection").offset();
                nv.tooltip.show([offset.left - containerOffset.left + leftScroll + self.barWidth, offset.top - containerOffset.top], self.getTooltip(d), 's', 5, document.getElementById("replicationStatsContainer"), "selectable-tooltip");
            })
            .transition()
            .attr("height", d => self.perfHeight - self.yScale(d.BatchSize))
            .attr("y", d => self.yScale(d.BatchSize));


        this.legend = this.perfSvg.select('.controlls').selectAll(".legend")
            .data(this.destinations, d => d);

        this.legend.selectAll("rect").transition()
            .attr("x", this.perfWidth - 18);

        this.legend.selectAll("text").transition()
            .attr("x", this.perfWidth - 24)
            .text(d => d);

        var legendEnter = this.legend
            .enter().append("g")
            .attr("class", "legend")
            .attr("transform", function (d, i) { return "translate(0," + i * 20 + ")"; });

        legendEnter.append("rect")
            .attr("x", this.perfWidth - 18)
            .attr('class', d => 'rect-legend-' + generalUtils.escape(d))
            .attr("width", 18)
            .attr("height", 18)
            .style("fill", self.color)
            .style("stroke", self.color)
            .on('click', d => self.toggleGroupVisible(d));

        legendEnter.append("text")
            .attr("x", this.perfWidth - 24)
            .attr("y", 9)
            .attr("dy", ".35em")
            .style("text-anchor", "end")
            .text(d => d);

        this.legendWidth = d3.max(<any>$(".legend text"), (d: any) => d.getBBox().width) + 40;

        this.perfSvg.select('.legend_bg')
            .attr('y', -6)
            .attr('height', this.destinations.length * 20 + 10)
            .attr('width', this.legendWidth)
            .attr('x', this.perfWidth - this.legendWidth + 10);
    }

    onWindowHeightChanged() {
        nv.tooltip.cleanup();
        this.perfWidth = $("#replicationTopologySection").width() - this.panelBodyPadding*2;
        this.perfHeight = $("#replicationStatsContainer").height();
        this.redrawGraph();
    }

    getTooltip(d) {
        return "<strong>Destionation:</strong> <span>" + d.Destination + "</span><br />"
            + "<strong>Duration milliseconds:</strong> <span>" + d.DurationMilliseconds + "</span><br />"
            + "<strong>Batch size:</strong> <span>" + d.BatchSize + "</span><br />"
            ;
    }

    findDestinations(jsonData) {
        var statsInline = d3.merge(jsonData.map((d) => d.Stats));
        var byKey = d3
            .nest()
            .key(d => d.Destination)
            .sortKeys(d3.ascending)
            .rollup(l => l.length)
            .entries(statsInline);
        return byKey.map(d => d.key);
    }

    detached() {
        super.detached();

        $("#visualizerContainer").off('DynamicHeightSet');
        nv.tooltip.cleanup();
    }

    replicationStatToggle() {
        setTimeout(() => this.redrawGraph(), 1);
    }
}

export = replicationStats;