const _ = require('lodash')
const { assert, expect } = require('chai')
const should = require('chai').should()
const {
  Network,
  methods,
  config,
  architect,
  Node,
  Connection,
  Group
} = require('../../../src/carrot')


const mutation = methods.mutation;

/**
 *
 * There are 5 questions every unit test must answer.
 *
 * What is the unit under test (module, function, class, whatever)?
 * What should it do? (Prose description)
 * What was the actual output?
 * What was the expected output?
 * How do you reproduce the failure?
 *
 */
describe('Network', function(){
  // a helper function to facilitate testing
  // creates a network with hidden nodes and uses it a little bit
  function createUsedNetwork() {
    const network = new Network(10, 20);

    // add some nodes that will (or not) be dropped out
    const new_nodes = Array(10).fill({}).map(() => new Node());
    network.addNodes(new_nodes);
    // connect the nodes randomly
    new_nodes.forEach(node => {
      const input_node_index = Math.floor(Math.random() * 10);
      const output_node_index = 10 + Math.floor(Math.random() * 20);
      network.nodes[input_node_index].connect(node);
      node.connect(network.nodes[output_node_index]);
    });

    // generate random input to test the network
    const input = Array(10).fill(0).map(() => Math.random());

    const output = network.activate(input, { dropout_rate: 0.5 });

    return network;
  }

  describe('new Network()', function () {
    it('new Network() => {TypeError}', function () {
      // missing input or output size
      expect(() => new Network()).to.throw(TypeError);
      expect(() => new Network(3461)).to.throw(TypeError);
    })

    it('new Network(input_size, output_size) => {Network}', function () {
      const network = new Network(10, 20);
      expect(network).to.be.an.instanceOf(Network);
      expect(network.nodes).to.be.of.length(30);
    })
  })

  describe('network.connect()', function () {
    it('network.connect() => {Connection[]}', function () {
      const network = new Network(10, 20);
      const source_node = new Node();
      const target_node = network.nodes[25];
      const formed_connections = network.connect(source_node, target_node, 7);
      expect(formed_connections).to.be.an(`array`);
      expect(formed_connections).to.be.of.length(1);

      const formed_connection = formed_connections[0];

      expect(formed_connection).to.be.an.instanceOf(Connection);
      expect(formed_connection.from).eql(source_node);
      expect(formed_connection.to).eql(target_node);
    })
  })

  describe('network.activate()', function () {
    it('network.activate(Array<Number>) => {Array<Number>}', function () {
      const network = new Network(10, 20);
      const input = Array(10).fill(0).map(() => Math.random());
      const simple_case_output = network.activate(input);
      expect(simple_case_output).to.be.an("array");
      expect(simple_case_output).to.be.of.length(20);
      simple_case_output.forEach((val) => expect(val).to.be.a('number'));

      // add a node and check that the output changed
      const new_node = new Node();
      network.addNodes(new_node);
      network.nodes[7].connect(new_node);
      new_node.connect(network.nodes[24]);

      const added_node_output = network.activate(input);

      for (let i = 0; i < 20; i++) {
        if (i !== 14) { // the added node was connected to output 14 (node 24 in the network)
          expect(simple_case_output[i]).to.equal(added_node_output[i]);
        } else {
          expect(simple_case_output[i]).to.not.equal(added_node_output[i]);
        }
      }

      // run again (without changing the network) and check that the output hasn't changed
      const rerun_output = network.activate(input);
      for (let i = 0; i < 20; i++) {
        expect(rerun_output[i]).to.equal(added_node_output[i]);
      }
    })
    it('network.activate(Array<Number>, {dropout_rate: Number}) => {Array<Number>}', function () {
      // check that droupout=false (so training=false) returns same values twice
      // check that droupout=true returns different from drouput=false, and different again on rerun
      const network = new Network(10, 20);

      // add some nodes that will (or not) be dropped out
      const new_nodes = Array(10).fill({}).map(() => new Node());
      network.addNodes(new_nodes);
      // connect the nodes randomly
      new_nodes.forEach(node => {
        const input_node_index = Math.floor(Math.random() * 10);
        const output_node_index = 10 + Math.floor(Math.random() * 20);
        network.nodes[input_node_index].connect(node);
        node.connect(network.nodes[output_node_index]);
      });

      // generate random input to test the network
      const input = Array(10).fill(0).map(() => Math.random());

      // outputs to test (in)equality
      const no_dropout_options = {dropout_rate: 0};
      const normal_dropout_options = {dropout_rate: 0.5};
      const all_nodes_dropped_options = {dropout_rate: 1};

      const first_dropout_off_output = network.activate(input, no_dropout_options);
      const second_dropout_off_output = network.activate(input, no_dropout_options);
      const first_dropout_on_output = network.activate(input, normal_dropout_options);
      const second_dropout_on_output = network.activate(input, normal_dropout_options);
      const first_full_dropout_output = network.activate(input, all_nodes_dropped_options);
      const second_full_dropout_output = network.activate(input, all_nodes_dropped_options);

      // check the results..
      expect(first_dropout_off_output).to.eql(second_dropout_off_output);
      expect(first_dropout_off_output).to.not.eql(first_dropout_on_output);
      expect(first_dropout_on_output).to.not.eql(second_dropout_on_output);
      expect(first_dropout_on_output).to.not.eql(first_full_dropout_output);
      expect(first_full_dropout_output).to.eql(second_full_dropout_output);
    })
  })

  describe('network.clear()', function () {
    it('network.clear() => {undefined}', function () {
      const test_network = createUsedNetwork();

      test_network.clear();
      test_network.nodes.forEach(node => {
        expect(node.error_responsibility).to.equal(0);
        expect(node.error_projected).to.equal(0);
        expect(node.error_gated).to.equal(0);
        expect(node.old).to.equal(0);
        expect(node.state).to.equal(0);
        expect(node.activation).to.equal(0);
      });
    })
  })

  describe('network.mutate()', function() {
    describe('mutation.SUB_NODE', function() {
      it('given a network with 7 nodes, should produce a network with 6', function(){
        // const network = new architect.Random(2,3,2);
        const network = new architect.Perceptron(2,3,2);

        network.mutate(mutation.SUB_NODE);

        expect(network.nodes.length).to.equal(6);
      });

      it('given a network with no hidden nodes, should keep network unchanged', function(){
        // Update "new Network" to allow for hidden nodes
        let network = new architect.Random(2,0,2); // strange workaround
        let network2 = _.cloneDeepWith(network)

        network2.mutate(mutation.SUB_NODE);

        assert.deepEqual(network.toJSON(), network2.toJSON())
      });

      it('given mutation.SUB_NODE.mutateOutput = false, should leave output nodes unchanged', function() {
        let network = new architect.Random(2,50,2);

        let outputs = _.filter(network.nodes, (node) => {
          return (node.type === 'output')
        })

        let total = network.nodes.length;
        for(let i = 0; i < total; i++) {
          network.mutate(mutation.SUB_NODE)
        }

        assert.deepEqual(outputs, _.filter(network.nodes, (node) => { return (node.type === 'output') }))
      })

    });
  })

  describe('network.clone() - WIP', function() {
    it('network.clone() => {Network}', function () {
      const test_origin_network = createUsedNetwork();
      const cloned_network = test_origin_network.clone();

      expect(cloned_network.input_nodes.size).to.equal(test_origin_network.input_nodes.size);
      expect(cloned_network.output_nodes.size).to.equal(test_origin_network.output_nodes.size);
    })
  })

  describe('network.addNodes()', function () {
    it('network.addNodes(Node) => {Network}', function () {
      const test_network = new Network(10, 20);

      // test the network before adding the nodes
      // generate random input to test the network
      const random_input = Array(10).fill(0).map(() => Math.random());
      const original_output = test_network.activate(random_input, { dropout_rate: 0 });

      // add the nodes
      const test_node = new Node();
      test_network.nodes[7].connect(test_node);
      test_node.connect(test_network.nodes[27]);
      test_network.addNodes(test_node);

      // test the network after adding the nodes. The output should be different
      expect(test_network.nodes).to.be.of.length(31);
      const new_output = test_network.activate(random_input, { dropout_rate: 0 });
      expect(new_output).to.not.eql(original_output);

    })

    it('network.addNodes(Node[]) => {Network}', function () {
      const test_network = new Network(10, 20);

      // test the network before adding the nodes
      // generate random input to test the network
      const random_input = Array(10).fill(0).map(() => Math.random());
      const original_output = test_network.activate(random_input, { dropout_rate: 0 });

      // add the nodes
      const test_node = new Node();
      test_network.nodes[7].connect(test_node);
      test_node.connect(test_network.nodes[27]);

      const test_node2 = new Node();
      test_network.nodes[5].connect(test_node2);
      test_node2.connect(test_network.nodes[25]);

      const node_array = [test_node, test_node2];
      test_network.addNodes(node_array);

      // test the network after adding the nodes. The output should be different
      expect(test_network.nodes).to.be.of.length(32);
      const new_output = test_network.activate(random_input, { dropout_rate: 0 });
      expect(new_output).to.not.eql(original_output);
    })

    it('network.addNodes(Group) => {Network}', function () {
      const test_network = new Network(10, 20);

      // test the network before adding the nodes
      // generate random input to test the network
      const random_input = Array(10).fill(0).map(() => Math.random());
      const original_output = test_network.activate(random_input, { dropout_rate: 0 });

      // add the nodes
      const test_group = new Group(2);
      const test_node = test_group.nodes[0];


      test_network.nodes[7].connect(test_node);
      test_node.connect(test_network.nodes[27]);

      const test_node2 = test_group.nodes[1];
      test_network.nodes[5].connect(test_node2);
      test_node2.connect(test_network.nodes[25]);

      test_network.addNodes(test_group);

      // test the network after adding the nodes. The output should be different
      expect(test_network.nodes).to.be.of.length(32);
      const new_output = test_network.activate(random_input, { dropout_rate: 0 });
      expect(new_output).to.not.eql(original_output);
    })
  })

  describe('network.propagate()', function () {
    it('network.propagate(rate, momentum, update, target_output) => {undefined}', function () {
      const upper_test_epoch_limit = 1000; // will attempt to propagate this many times

      const test_network = createUsedNetwork();

      // train the network to output all 1s.
      const input_size = test_network.input_nodes.size;
      const output_size = test_network.output_nodes.size;
      const ideal_output = Array(output_size).fill(1);

      for (let i = 0; i < upper_test_epoch_limit; i++) {
        const random_input = Array(input_size).fill(0).map(() => Math.random());
        test_network.activate(random_input);
        test_network.propagate(0.05, 0.0001, true, ideal_output);
      }

      const random_input = Array(input_size).fill(0).map(() => Math.random());
      const test_output = test_network.activate(random_input);

      const epsilon = 0.05;
      test_output.forEach((value, index) => {
        expect(value).to.be.closeTo(ideal_output[index], epsilon);
      });

    })
  })

})
