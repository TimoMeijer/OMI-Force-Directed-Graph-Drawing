var omi = {};

(function() {
    'use strict';

    omi.Research = function(settings) {
        var that = this;

        that.settings = $.extend({
                linkStrengths: [], // linkStrengths to be tested
                charges: [], // charges to be tested
                graphs: [], // graphs to be tested, defined as [vertexCount, edgeCount]
                graphRepeat: 1, // How many different graphs will be tested for each combination of vertex/edges
                repeat: 1, // How many times each configuration will be tested
                metrics: {}, // Metric functions to be used to process the generated graph, as name/metric pairs
                wolframUrl: undefined, // The Wolfram API URL where graphs can be fetched from
                visual: true, // If a visual interface should be selector
                selector: '#omi', // Element where the visual interface will be rendered in
                width: 960, // Width of the test area for the algorithm
                height: 500, // height of the test area for the algorithm
                scale: 1, // Scale to display the interface on a different scale than the test area
                seed: 0 // Seed to be used for the random generation of graphs
            },
            settings
        );

        that.testFinished = new signals.Signal();

        that.numTests = that.settings.linkStrengths.length * that.settings.charges.length
            * that.settings.graphs.length * that.settings.graphRepeat * that.settings.repeat;

        that.start = function() {
            // As this is done async, we use a Promise to signal when we're ready to return the results
            var resultDeferred = $.Deferred();

            // Get graphs for each graphs settings
            var seed = that.settings.seed;
            var graphDeferreds = that.settings.graphs.map(function(graphSetting) {
                return omi.wolframGetGraphs(that.settings.wolframUrl, graphSetting[0], graphSetting[1], that.settings.graphRepeat, seed++)
                    // Transform Wolfram data to graphs usable by d3
                    .then(function(graphData) {
                        return graphData.map(omi.edgesToGraph);
                    });
            });

            // When all graphs are retrieved, continue
            $.when.apply($, graphDeferreds).done(function() {
                var graphsSet = Array.prototype.slice.call(arguments);

                // Add a iteration to each graph, for easy identification
                graphsSet.forEach(function(graphs) {
                    graphs.forEach(function(graph, i) {
                        graph.iteration = i;
                    });
                });

                // Squash the set into a simple array of graphs
                var graphs = graphsSet.reduce(function(c, x) { return c.concat(x); }, []);

                // Create a configuration array with all configurations to be tested
                var configurations = omi.combinations(that.settings.linkStrengths, that.settings.charges, graphs);

                // Repeat each configuration a set number of times, and create proper settings objects
                var results = [];
                configurations.forEach(function(setting) {
                    for (var i = 0; i < that.settings.repeat; i++) {
                        results.push({
                            linkStrength: setting[0],
                            charge: setting[1],
                            graph: $.extend(true, {}, setting[2]),
                            graphIteration: setting[2].iteration,
                            iteration: i
                        });
                    }
                });

                // Smart way to execute each test in sequence
                results.reduce(
                    function(previous, setting) {
                        var deferred = $.Deferred();

                        previous.done(function() {
                            that.runTest(setting.linkStrength, setting.charge, setting.graph)
                                .done(function() { deferred.resolve(); });
                        });

                        return deferred;
                    },
                    $.Deferred().resolve()
                ).done(function() {
                    resultDeferred.resolve(results);
                });
            });

            // Process results
            return resultDeferred.then(function(results) {
                return results.map(function(settings) {
                    var graph = settings.graph;
                    delete settings.graph;
                    settings.vertexCount = graph.nodes.length;
                    settings.edgeCount = graph.links.length;

                    var results = {};

                    for (var name in that.settings.metrics) {
                        if (that.settings.metrics.hasOwnProperty(name)) {
                            results[name] = that.settings.metrics[name](graph);
                        }
                    }

                    return {
                        settings: settings,
                        results: results
                    }
                });
            });
        };

        that.runTest = function(linkStrength, charge, graph) {
            var layout = d3.layout.force()
                .charge(charge)
                .linkStrength(linkStrength)
                .size([that.settings.width, that.settings.height])
                .nodes(graph.nodes)
                .links(graph.links);

            if (that.settings.visual) {
                var color = d3.scale.category20();

                d3.select(that.settings.selector).html('<svg id="omiTestEnv"></svg>');
                var svg = d3.select('#omiTestEnv')
                    .attr('width', that.settings.width * that.settings.scale)
                    .attr('height', that.settings.height * that.settings.scale);

                var link = svg.selectAll('.link')
                    .data(graph.links)
                    .enter().append('line')
                    .attr('class', 'link');

                var node = svg.selectAll('.node')
                    .data(graph.nodes)
                    .enter().append('circle')
                    .attr('class', 'node')
                    .attr('r', 5)
                    .style('fill', function(d) { return color(d.group); });

                node.append('title')
                    .text(function(d) { return d.name; });

                layout.on('tick', function() {
                    link.attr('x1', function(d) { return d.source.x * that.settings.scale; })
                        .attr('y1', function(d) { return d.source.y * that.settings.scale; })
                        .attr('x2', function(d) { return d.target.x * that.settings.scale; })
                        .attr('y2', function(d) { return d.target.y * that.settings.scale; });

                    node.attr('cx', function(d) { return d.x * that.settings.scale; })
                        .attr('cy', function(d) { return d.y * that.settings.scale; });
                });
            }

            var defer = $.Deferred();

            layout.on('end', function() {
                that.testFinished.dispatch(linkStrength, charge, graph);

                defer.resolve(graph);
            });

            layout.start();

            return defer.promise();
        };

        return that;
    };

    omi.ProgressBar = function($bar, max) {
        var that = this;
        var current = 0;

        that.add = function(val) {
            current += val;

            that.updateValue();
            that.updateText();
        };

        that.updateValue = function() {
            $bar.attr('aria-valuenow', current);
            $bar.css('width', current*100/max + '%');
        };

        that.updateText = function() {
            $bar.text(current+'/'+max);
        };

        // Initialization
        $bar.attr('aria-valuemin', 0);
        $bar.attr('aria-valuemax', max);
        that.updateValue();
        that.updateText();

        return that;
    };

    omi.resultsToCsv = function(results) {
        // Header
        var csv = [];
        csv[0] = [];

        for (var key in results[0].settings) {
            if (results[0].settings.hasOwnProperty(key)) {
                csv[0].push(key);
            }
        }
        for (key in results[0].results) {
            if (results[0].results.hasOwnProperty(key)) {
                csv[0].push(key);
            }
        }

        results.forEach(function(result, i) {
            var row = [];

            for (var key in result.settings) {
                if (result.settings.hasOwnProperty(key)) {
                    row.push(result.settings[key]);
                }
            }
            for (key in result.results) {
                if (result.results.hasOwnProperty(key)) {
                    row.push(result.results[key].toString().replace('.', ','));
                }
            }

            csv.push(row);
        });

        return d3.tsv.formatRows(csv);
    };

    omi.wolframGetGraphs = function(url, n, m, k, s) {
        // Can also be done with d3.json, but I'm more familiar with jQuery, and it's more feature rich
        var request = $.ajax(url, {
            dataType: 'json',
            data: {
                n: n,
                m: m,
                k: k,
                s: s
            }
        }).then(
            // Modify data to return only the EdgeList, formatted as an Array
            function(data) {
                var result = data.Result;

                result = result.replace(/UndirectedEdge/g, '')
                    .replace(/{/g, '[')
                    .replace(/}\n/g, '],')
                    .replace(/}/g, ']');
                result = eval('['+result+']'); // Just eval that stuff, what could possibly go wrong!

                // Reduce identifiers by one, as we want to start counting from 0 instead of 1
                result = result.map(function(graph) {
                    return graph.map(function(edge) {
                        return [edge[0] - 1, edge[1] - 1];
                    });
                });

                return result;
            }
        );

        return request.promise();
    };

    // Convert from an edge array to a Graph object recognized by d3
    omi.edgesToGraph = function(edges) {
        var result = {
            links: [],
            nodes: []
        };

        edges.forEach(function (edge) {
            result.links.push({
                source: edge[0],
                target: edge[1]
            });

            result.nodes[edge[0]] = {};
            result.nodes[edge[1]] = {};
        });

        return result;
    };

    // Parameters should be arrays, and calculates all combinations between the items in these arrays
    // Modified from: http://codereview.stackexchange.com/a/52126
    omi.combinations = function() {
        var input = Array.prototype.slice.call(arguments);

        // Check if each argument is an array, and is not empty
        if (!input.every(function (arg) { return arg.length})) {
            return [];
        }

        // Internal recursive function
        function combine(list) {
            var prefixes, combinations;

            if (list.length === 1) {
                return list[0].map(function(x) {return [x];});
            }

            prefixes = list[0];
            combinations = combine(list.slice(1)); // recurse

            // produce a flat list of each of the current
            // set of values prepended to each combination
            // of the remaining sets.
            return prefixes.reduce(function(memo, prefix) {
                return memo.concat(combinations.map(function(combination) {
                    return [prefix].concat(combination);
                }));
            }, []);
        }

        return combine(input);
    };

    omi.edgeLength = function(edge) {
        return Math.sqrt(Math.pow(edge.source.x - edge.target.x, 2) + Math.pow(edge.source.y - edge.target.y, 2));
    };
    omi.edgeLengths = function(graph) {
        return graph.links.map(omi.edgeLength);
    };

    omi.metric = {
        edgeCrossings: function(graph) {
            // Adapted from: https://gist.github.com/Joncom/e8e8d18ebe7fe55c3894
            var lineIntersect = function(p0_x, p0_y, p1_x, p1_y, p2_x, p2_y, p3_x, p3_y) {

                var s1_x, s1_y, s2_x, s2_y;
                s1_x = p1_x - p0_x;
                s1_y = p1_y - p0_y;
                s2_x = p3_x - p2_x;
                s2_y = p3_y - p2_y;

                var s, t;
                s = (-s1_y * (p0_x - p2_x) + s1_x * (p0_y - p2_y)) / (-s2_x * s1_y + s1_x * s2_y);
                t = ( s2_x * (p0_y - p2_y) - s2_y * (p0_x - p2_x)) / (-s2_x * s1_y + s1_x * s2_y);

                return (s > 0 && s < 1 && t > 0 && t < 1);
            };

            var pairs = omi.combinations(graph.links, graph.links);

            var crossingPairs = pairs.filter(function(pair) {
                return lineIntersect(pair[0].source.x, pair[0].source.y, pair[0].target.x, pair[0].target.y,
                    pair[1].source.x, pair[1].source.y, pair[1].target.x, pair[1].target.y);
            });

            return crossingPairs.length/2; // Divide by two, as we gather both pairs (a,b) and (b,a).
        },
        edgeLengthAverage: function(graph) {
            return omi.edgeLengths(graph).reduce(function(carry, length) {
                    return carry + length;
                }, 0) / graph.links.length;
        },
        edgeLengthDeviation: function(graph) {
            var edgeLengths = omi.edgeLengths(graph);
            var mean = omi.metric.edgeLengthAverage(graph);

            var squaredDifferences = edgeLengths.map(function(length) {
                return Math.pow(length - mean, 2);
            });

            return Math.sqrt(squaredDifferences.reduce(function(carry, squaredDifference) {
                    return carry + squaredDifference;
                }, 0) / squaredDifferences.length;
        }/*, TODO: Decide how exactly we want to handle & calculate this
        angularResolution: function(graph) {

        }*/
    };
})();