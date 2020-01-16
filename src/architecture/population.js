const _ = require('lodash');
const Network = require('./network');
const Species = require('./species')
const methods = require('../methods/methods');
const util = require('../util/utils');
const config = require('../config');

/**
* Runs an evolutionary algorithm (currently NEAT) on a group of neural networks.
*
* @constructs Population
*
* @alpha
*
* @param {Object} options **Configuration Options**
* @param {number} [options.inputs=1] Input layer size of population networks.
* @param {number} [options.outputs=1] Output layer size of population networks.
* @param {number} [options.size=150] Amount of networks to initialize population with.
* ------ EVO-SUPERVISED LEARNING SETTINGS ----
* @param {Array<{inputs:number[],outputs:number[]}>} [options.dataset] Population dataset, used to do "supervised learning" when not setting fitnesses manually - _datasets passed to `population.evolve()` after constuction will take precedence_
* @param {Function} [options.fitnessFn] Only if dataset present. Fitness function to evaluate networks. Takes (`dataset`, `genomes`) as arguments, genomes: a [network](Network) array. fitnessFn needs to set each network's `.fitness` property with a number.
* @param {cost} [options.cost=cost.MSE]  Only if dataset present. Used in conjuction with a dataset to calculate error and set fitnesses for networks automatically.
* @param {number} [options.clear=false] Only if dataset present. Clear context of networks' nodes, reverting them to 'new' neurons each generation. Useful for predicting timeseries with LSTM's.
* ------ EVOLUTIONARY MUTATION SETTINGS ----
* @param {mutation[]} [options.mutation] A set of allowed [mutation methods](mutation) for evolution. If unset a random mutation method from all possible mutation methods will be chosen when mutation occurs.
* @param {string} [options.selection=POWER] [Selection method](selection) for evolution (e.g. Selection.FITNESS_PROPORTIONATE).
* @param {number} [options.maxNodes=Infinity] Maximum nodes for a mutated network
* @param {number} [options.maxConns=Infinity] Maximum connections for a mutated network
* @param {number} [options.maxGates=Infinity] Maximum gates for a mutated network
* ------ POPULATION MANAGEMENT SETTINGS ----
* @param {number} [options.stagnantLimit=20] Maximum amount of generations population can go without improving before it is replaced entirely with children from top two species.
* @param {number} [options.speciesStagnantLimit=15] Maximum amount of generations species can go without improving before its members are not allowed to reproduce.
*
* @prop {number} generation A count of the generations, can be overwritten if desired
* @prop {Network[]} members The current population for the population instance. Accessible through `population.members`
* @protected {[Species[]]} species An array of population [Species](Species). Each Species has its own `.members` where the networks in the species are stored.
*
* @todo Remove very slow defaultsDeep
* @todo Add method to import networks that were evolved without id management, should work by initially setting ids of input & output nodes then traversing nodes array assigning node ids and corresponding connection ids sequentially while updating connIds and nodeIds.
*
* @example
* const { Population } = require("@liquid-carrot/carrot");
*
* // Creates a new population, generating networks automatically and handling ID management automatically
* let population = new Population({ inputs: 1, outputs: 1 }) // each network has one input and one output
*/
const Population = function(options) {
  const self = this;

  options = _.defaultsDeep(options, Population.default.options)

  // Internal prototype chain properties
  Object.assign(self, { 
    ...options, // options goes first so that any duplicate properties are overwritten by internal defaults
    species: [],
    stagnation: 0,
    generation: 0,
    lastNetId: 0,
    allTimeBest: null,
  });

  /**
   * Creates an array of networks, each network with a different set of weights, then returns it.
   *
   * Note: neat spec technically dictates that each network be exactly equivalent.
   * 
   * @alpha
   * 
   * @private
   * 
   * @function getPopulation
   * @memberof Population
   *
   * @param {Object} config A configuration object to control function behavior
   * @param {number} size The number of networks to place in the returned array
   * 
   * @return {Network[]} Returns an array of networks. Must be assigned to Population.members if replacing current population.
   * 
   * @todo Add template network functionality
   * @todo Add option to have identical population networks
   */
  self.getPopulation = function create_networks(config={}) {
    const population = []
    for (let i = 0; i < config.size; i++) {
      population.push(new Network(self.inputs, self.outputs, { connIds: self.connIds, nodeIds: self.nodeIds, id: i + 1 }));
    }

    // Update id variable
    self.lastNetId = config.size;

    return population
  };

  // Fill the members array on population construction
  self.members = self.getPopulation({ size: self.size });

  // Set founder fitness
  const founder = self.members[0];
  founder.fitness = 0;

  // Create first species with first member, don't add other members since .speciate just clears them anyway
  self.species.push(new Species(founder))

  // Set a same network as all-time-best
  self.allTimeBest = founder;

  /**
   * Applies the mutation-scheme dictated by Neat to the provided network.
   * 
   * Warning! Mutates argument directly.
   * 
   * @alpha
   * 
   * @function mutate
   * @memberof Population
   * 
   * @param {Network} network A network to add a node to (1% chance), add a new connection to (5% chance), and change have its weights changed (80% chance | 90% small change, 10% completely random) 
   * 
   * @return {Network} A network mutated by the Neat mutation spec.
   * 
   * @todo Remove hard-coded chance thresholds
   * @todo Consider making this a specialized mutate function: `neatMutate`
   */
  self.mutate = function (network, options={ neat: true }) {
    // Just do 1 random, if Math.random() is truly random then it should be equivalent to doing individual "Math.random()"s
    const random = Math.random()

    // 1% chance of new node
    if (random < 0.01) network = network.mutate(methods.mutation.ADD_NODE);

    // 5% chance of new connection (ADD_CONNECTION instead of: ADD_CONN)
    if (random < 0.05) network = network.mutate(methods.mutation.ADD_CONNECTION);

    // Helper function, mutates connection weights
    const mutateConn = function(conn) {

      const number = () => Math.random() * (Math.floor(Math.random()*2) == 1) ? 1 : -1;
      
      // Ensure weight stays in [-1, 1] range
      const clamp = function(number) {
        const large = (number > 1);
        const small = (number < -1);
        
        if(large) return 1;
        if(small) return -1;
        else return number;
      }

      // 90% chance slight change, +-0.5 at most | 10% chance new random value, between -1 and 1
      conn.weight = (random < .9) ? clamp(conn.weight + number() / 2) : number();

      return conn
    }

    // 80% chance of mutating all the weights
    if (random < 0.8) network.connections = network.connections.map(conn => mutateConn(conn))

    return network;
  }

  /**
   * Removes stagnant species first.
   * 
   * Then removes worst performers from surviving species, updates fitness for species' members, average species fitness, and population fitness.
   * 
   * Warning! Mutates argument and its descendants directly.
   * @alpha
   * 
   * @expects Sorted species members by descending fitness
   * 
   * @function removeMembers
   * @memberof Population
   * 
   * @param {Species[]} speciesArray An array of population Species objects
   * @param {Object} config A configuration object
   * @param {number} config.threshold A threshold that determines how much of the population inside each species survives. Higher numbers means more survive.
   * 
   * @returns {Species[]} A new species array with its species members pruned and its descendants fitness properties updated.
   * 
   * @todo Add tests
   */
  self.removeMembers = function (speciesArray, config={ threshold: 0.5 }) {

    // Code is deliberately monolithic, avoids repeated traversals of various arrays
    const populationTotal = 0;
    for(let i = 0; i < speciesArray.length; i++) {
      const s = speciesArray[i];
      
      // If species is stagnant, remove it immediately
      if(s.stagnation > 15) {
        speciesArray.splice(i,1);
        i--; continue; // Go to the next species
      } 

      // Otherwise just remove worst performers
      s.members = s.sift(s.members, config.threshold);
      
      // Update member fitnesses, sum species fitness
      let total = 0;
      const memberCount = s.members.length;
      for(let i = 0; i < memberCount; i++) {
        member = s.members[i];
  
        // Neat spec: adjust fitness to species members length
        member.sharedFitness = member.fitness / memberCount;
        total += member.sharedFitness;
      }
  
      // Store species fitness, sum population fitness
      s.averageFitness = total / memberCount;
      populationalTotal += s.averageFitness;
    }

    // Adjust population, non-obvious side-effect added for performance reasons 
    population.averageSpeciesFitness = populationTotal / speciesArray.length;

    return speciesArray;
  }

  /**
   * Replaces missing population after culling. INCOMPLETE
   * 
   * Warning! Mutates argument directly.
   * @alpha
   * 
   * @function resplaceMembers
   * @memberof Population
   * 
   * @param {Species[]} speciesArray An array of population Species objects
   * 
   * @returns {Species[]} A new species array with its species members replaced.
   * 
   * @todo Add tests
   * @todo Abstract child creation into a helper function
   */
  self.replaceMembers = function (speciesArray, totalMembers) {
     
    const kids = [];
    for (let i = speciesArray.length; i > 2; i--) {
      const s = speciesArray[i];

      // Calculate how many kids a species gets
      const alloted = Math.floor(s.averageFitness / self.averageSpeciesFitness * totalMembers) - 1; // minus one for NEAT elitism

      // If species gets no kids, remove it and go to next
      if(alloted <= 0) { self.species.splice(j,1); continue; }

      // Add best without any mutation
      kids.push(s.bestGenome.clone());

      // Get offspring and mutate
      for (let j = 0; j < alloted; j++) {
        kids.push(self.mutate(s.getChild()));
      }
    }

    // Take care of the two best species which are always protected
    // CODE FOR TAKING CARE OF TOP TWO SPECIES GOES HERE

    // If missing members due to rounding, get more from best species
    while (kids.length < totalMembers) {
      kids.push(self.species[0].getChild());
    }

    return kids;
  }

  /**
   * Evaluates, selects, breeds and mutates population.
   * 
   * Warning! Replaces `.members` directly and increases `.generation` by 1.
   * @alpha
   * 
   * @function evolve
   * @memberof Population
   *
   * @param {object} options
   * 
   * @return {network[]} An evolved population
   * 
   * @todo Reintroduce mutation flexibility
   * @todo Rename some commonly used self.* variable names 
   * @todo Spin-off managePopulation into its own function
   * @todo Add createOffspring code
   */
  self.evolve = async function(options={}) {

    // Check if fitnesses need to be set
    if(util.isNil(self.members[0].fitness)) {
      // Calculate poulation members fitness
      self.members = self.evaluate(self.members, self.dataset, self.cost);
    }

    // Sort member networks by fitness, in descending order
    self.members = util.sortObjects(members, "fitness", false); // sorting now means species members will also be sorted, saves 1 nested loop + a repeat loop

    // Reset population stagnation if fitness improvement
    if(self.members[0].fitness > self.allTimeBest) {
      self.allTimeBest = self.members[0].fitness;
      self.stagnation = 0;
    }
    // otherwise increase the stagnation
    else {
      self.stagnation += 1;
    }

    // Break population members into their respective species, update fitness records
    self.species = self.speciate(self.members, self.species);

    // Giant helper function
    const managePopulation = function (species, members) {
      // Remove worst niche members
      self.species = self.removeMembers(species, { threshold: 0.5 });

      // Replace population with mutated offspring.
      members = self.replaceMembers(species, members.length);

      self.generation += 1;

      return members;
    }

    // If population fitness is constant for too long, only top 2 species reproduce
    return (self.stagnant > self.stagnantLimit) ? managePopulation([self.species[0], self.species[1]], self.members) : managePopulation(self.species, self.members); 
  };

  /**
   * Places population members into their corresponding species, adjusts species performance & stagnation records.
   * 
   * Warning! Mutates population & species members directly!
   * 
   * @alpha
   * 
   * @expects Sorted population members by descending fitness
   * 
   * @function speciate
   * @memberof Population
   * 
   * @param {Network[]} members An array of population members to be placed in species
   * @param {Species[]} speciesArray The previous set of population species
   * 
   * @return {Species[]} Descendingly sorted species array with corresponding members of the population inside, also descendingly sorted
   * 
   * @todo Consider making this a Rust + WASM function
   * @todo Add tests for species performance management
   * @todo Benchmark
   */
  self.speciate = function (members, speciesArray) {    
    // First clear the members of each species
    speciesArray = speciesArray.map(species => {
      species.members = [];
      return species;
    })

    // "outer" is a loop label. Avoids checking whether genome was placed in species inside inner-loop.
    outer:
    for (let i = 0; i < members.length; i++) {
      const genome = members[i];
      for(let j = 0; j < speciesArray.length; j++) {
        const species = speciesArray[j];

        // Determine if genome belongs in species
        if(species.isCompatible([species.representative, genome])) {

          // If first genome in species, adjust species records
          if(!species.members.length) {

            // Update the current best
            species.setBest(genome);

            // If all-time best, reset stagnation & update best of all time
            if(genome.fitness > species.allTimeBest) {
              species.resetStagnation();
              species.setGOAT(genome);
            }
            
            // else, species is stagnant
            else species.incrementStagnation()
          }
          
          species.addMember(genome);

          continue outer; // <- Use "outer" to skip to next genome.
        }
      }
     
      // Only runs if genome was not placed in species
      speciesArray.push(new Species(genome));
    }

    return speciesArray;
  }

  /**
   * Tests population members against a dataset, setting their `.fitness` property
   *
   * @function evaluate
   *
   * @memberof Neat
   *  
   * @param {Network[]} members Population members to evaluate
   * @param {Object[]} dataset Dataset to use for evaluation. Each entry is an object with sample inputs and outputs for the networks to be scored on.
   * @param {Object[]} [config] Configuration object
   * 
   * @return {Network[]} Population with .fitness properties set
   * 
   * @todo Make this an async function
   * @todo Make the default fitness function an async function
   * @todo Consider porting cost function to Rust + WASM
   * @todo Add tests to verify accuracy
   */
  self.evaluate = function (members, dataset, cost) {

    for(let i = 0; i < members.length; i++) {
      const network = members[i];
      network.fitness = self.fitnessFn(network, dataset, cost);
    }

    return members;
  } 

}

Population.default = {
  options: {
    inputs: 1,
    outputs: 1,
    size: 150,
    dataset: [],
    cost: methods.cost.MSE,
    fitnessFn: function(network, set, cost) {
      return network.test(set, cost).error
    },
    fitnessPopulation: false,
    mutation: methods.mutation.NEATSTANDARD,
    selection: methods.selection.POWER,
    maxNodes: Infinity,
    maxConns: Infinity,
    maxGates: Infinity,
    // internal id management variables, leaving here in case user would like to override these
    nodeIds: { last: 0 },
    connIds: { last: 0 },
  }
}

module.exports = Population;
