use wasm_bindgen::prelude::*;
use rand::Rng;
use js_sys::Float64Array;

// Better panic messages in debug mode
#[cfg(feature = "console_error_panic_hook")]
pub fn set_panic_hook() {
    console_error_panic_hook::set_once();
}

/// Distribution component types
#[derive(Clone)]
enum Component {
    Atom { x: f64, p: f64 },
    Bin { a: f64, b: f64, p: f64 },
    Tail { x0: f64, mass: f64, lambda: f64, is_right: bool },
}

/// Parse components from flat array format:
/// [type, ...params, type, ...params, ...]
/// type: 0=atom, 1=bin, 2=tail
fn parse_components(data: &[f64]) -> Vec<Component> {
    let mut components = Vec::new();
    let mut i = 0;
    
    while i < data.len() {
        let comp_type = data[i] as i32;
        match comp_type {
            0 => {
                // Atom: type, x, p
                if i + 2 < data.len() {
                    components.push(Component::Atom {
                        x: data[i + 1],
                        p: data[i + 2],
                    });
                }
                i += 3;
            }
            1 => {
                // Bin: type, a, b, p
                if i + 3 < data.len() {
                    components.push(Component::Bin {
                        a: data[i + 1],
                        b: data[i + 2],
                        p: data[i + 3],
                    });
                }
                i += 4;
            }
            2 => {
                // Tail: type, x0, mass, lambda, is_right
                if i + 4 < data.len() {
                    components.push(Component::Tail {
                        x0: data[i + 1],
                        mass: data[i + 2],
                        lambda: data[i + 3],
                        is_right: data[i + 4] > 0.5,
                    });
                }
                i += 5;
            }
            _ => {
                i += 1;
            }
        }
    }
    
    components
}

/// Build alias table for O(1) sampling
struct AliasTable {
    prob: Vec<f64>,
    alias: Vec<usize>,
    components: Vec<Component>,
}

impl AliasTable {
    fn new(components: Vec<Component>) -> Self {
        let n = components.len();
        if n == 0 {
            return Self {
                prob: vec![],
                alias: vec![],
                components: vec![],
            };
        }

        // Get weights
        let weights: Vec<f64> = components.iter().map(|c| match c {
            Component::Atom { p, .. } => *p,
            Component::Bin { p, .. } => *p,
            Component::Tail { mass, .. } => *mass,
        }).collect();

        let total: f64 = weights.iter().sum();
        if total == 0.0 {
            return Self {
                prob: vec![1.0; n],
                alias: (0..n).collect(),
                components,
            };
        }

        // Scale to n
        let mut prob: Vec<f64> = weights.iter().map(|w| w / total * n as f64).collect();
        let mut alias: Vec<usize> = vec![0; n];

        let mut small: Vec<usize> = Vec::new();
        let mut large: Vec<usize> = Vec::new();

        for i in 0..n {
            if prob[i] < 1.0 {
                small.push(i);
            } else {
                large.push(i);
            }
        }

        while !small.is_empty() && !large.is_empty() {
            let l = small.pop().unwrap();
            let g = large.pop().unwrap();
            alias[l] = g;
            prob[g] = prob[g] + prob[l] - 1.0;
            if prob[g] < 1.0 {
                small.push(g);
            } else {
                large.push(g);
            }
        }

        // Handle remaining due to floating point errors
        while let Some(g) = large.pop() {
            prob[g] = 1.0;
        }
        while let Some(l) = small.pop() {
            prob[l] = 1.0;
        }

        Self { prob, alias, components }
    }

    fn sample(&self, rng: &mut impl Rng) -> f64 {
        if self.components.is_empty() {
            return 0.0;
        }

        let n = self.components.len();
        let u: f64 = rng.gen::<f64>() * n as f64;
        let i = u as usize;
        let y = u - i as f64;

        let idx = if y < self.prob[i.min(n - 1)] { i.min(n - 1) } else { self.alias[i.min(n - 1)] };
        
        match &self.components[idx] {
            Component::Atom { x, .. } => *x,
            Component::Bin { a, b, .. } => a + rng.gen::<f64>() * (b - a),
            Component::Tail { x0, lambda, is_right, .. } => {
                let exp_sample = -rng.gen::<f64>().ln() / lambda;
                if *is_right { x0 + exp_sample } else { x0 - exp_sample }
            }
        }
    }
}

/// Run Monte Carlo simulation
/// 
/// # Arguments
/// * `components_data` - Flat array of component data
/// * `init_wealth` - Initial wealth
/// * `steps` - Number of steps per trial
/// * `num_trials` - Number of simulation trials
/// 
/// # Returns
/// Number of trials that resulted in ruin
#[wasm_bindgen]
pub fn run_monte_carlo(
    components_data: Float64Array,
    init_wealth: f64,
    steps: u32,
    num_trials: u32,
) -> u32 {
    #[cfg(feature = "console_error_panic_hook")]
    set_panic_hook();

    let data: Vec<f64> = components_data.to_vec();
    let components = parse_components(&data);
    let alias_table = AliasTable::new(components);

    let mut rng = rand::thread_rng();
    let mut ruin_count: u32 = 0;

    for _ in 0..num_trials {
        let mut wealth = init_wealth;
        
        for _ in 0..steps {
            wealth += alias_table.sample(&mut rng);
            if wealth <= 0.0 {
                ruin_count += 1;
                break;
            }
        }
    }

    ruin_count
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_components() {
        // atom: type=0, x=10, p=0.5
        let data = vec![0.0, 10.0, 0.5];
        let comps = parse_components(&data);
        assert_eq!(comps.len(), 1);
    }
}

/// Serialize components back to flat array format
fn serialize_components(components: &[Component]) -> Vec<f64> {
    let mut result = Vec::new();
    for c in components {
        match c {
            Component::Atom { x, p } => {
                result.push(0.0);
                result.push(*x);
                result.push(*p);
            }
            Component::Bin { a, b, p } => {
                result.push(1.0);
                result.push(*a);
                result.push(*b);
                result.push(*p);
            }
            Component::Tail { x0, mass, lambda, is_right } => {
                result.push(2.0);
                result.push(*x0);
                result.push(*mass);
                result.push(*lambda);
                result.push(if *is_right { 1.0 } else { 0.0 });
            }
        }
    }
    result
}

/// Convolve two components
fn convolve_pair(c1: &Component, c2: &Component) -> Option<Component> {
    match (c1, c2) {
        // Atom + Atom = Atom
        (Component::Atom { x: x1, p: p1 }, Component::Atom { x: x2, p: p2 }) => {
            Some(Component::Atom { x: x1 + x2, p: p1 * p2 })
        }
        // Atom + Bin = shifted Bin
        (Component::Atom { x, p: p1 }, Component::Bin { a, b, p: p2 }) |
        (Component::Bin { a, b, p: p2 }, Component::Atom { x, p: p1 }) => {
            Some(Component::Bin { a: a + x, b: b + x, p: p1 * p2 })
        }
        // Bin + Bin = approximated Bin (matching mean and variance)
        (Component::Bin { a: a1, b: b1, p: p1 }, Component::Bin { a: a2, b: b2, p: p2 }) => {
            let w1 = b1 - a1;
            let w2 = b2 - a2;
            let v1 = w1 * w1 / 12.0;
            let v2 = w2 * w2 / 12.0;
            let new_var = v1 + v2;
            let new_width = (12.0 * new_var).sqrt();
            let center1 = (a1 + b1) / 2.0;
            let center2 = (a2 + b2) / 2.0;
            let new_mean = center1 + center2;
            Some(Component::Bin {
                a: new_mean - new_width / 2.0,
                b: new_mean + new_width / 2.0,
                p: p1 * p2,
            })
        }
        // Tail combinations - skip (mass loss, handled in JS)
        _ => None
    }
}

/// Convolve two distributions
/// Returns flat array of result components
#[wasm_bindgen]
pub fn convolve_distributions(
    dist1_data: Float64Array,
    dist2_data: Float64Array,
) -> Float64Array {
    #[cfg(feature = "console_error_panic_hook")]
    set_panic_hook();

    let data1: Vec<f64> = dist1_data.to_vec();
    let data2: Vec<f64> = dist2_data.to_vec();
    
    let comps1 = parse_components(&data1);
    let comps2 = parse_components(&data2);
    
    let mut result: Vec<Component> = Vec::with_capacity(comps1.len() * comps2.len());
    
    for c1 in &comps1 {
        for c2 in &comps2 {
            if let Some(c) = convolve_pair(c1, c2) {
                result.push(c);
            }
        }
    }
    
    let serialized = serialize_components(&result);
    Float64Array::from(serialized.as_slice())
}

// ===========================================
// Dist Operations - Phase 1 Full Rust Implementation
// ===========================================

/// Get weight of a component
fn get_weight(c: &Component) -> f64 {
    match c {
        Component::Atom { p, .. } => *p,
        Component::Bin { p, .. } => *p,
        Component::Tail { mass, .. } => *mass,
    }
}

/// Calculate mean of distribution
#[wasm_bindgen]
pub fn dist_mean(components_data: Float64Array) -> f64 {
    let data: Vec<f64> = components_data.to_vec();
    let components = parse_components(&data);
    
    let total_p: f64 = components.iter().map(get_weight).sum();
    if total_p == 0.0 {
        return 0.0;
    }
    
    let mut sum = 0.0;
    for c in &components {
        match c {
            Component::Atom { x, p } => {
                sum += x * p;
            }
            Component::Bin { a, b, p } => {
                let center = (a + b) / 2.0;
                sum += center * p;
            }
            Component::Tail { x0, mass, lambda, is_right } => {
                // Mean of exponential part: x0 ± 1/lambda
                let exp_mean = if *is_right { x0 + 1.0 / lambda } else { x0 - 1.0 / lambda };
                sum += exp_mean * mass;
            }
        }
    }
    sum / total_p
}

/// Calculate variance of distribution
#[wasm_bindgen]
pub fn dist_variance(components_data: Float64Array) -> f64 {
    let data: Vec<f64> = components_data.to_vec();
    let components = parse_components(&data);
    
    let total_p: f64 = components.iter().map(get_weight).sum();
    if total_p == 0.0 {
        return 0.0;
    }
    
    // Calculate mean first
    let mean = dist_mean(components_data.clone());
    
    let mut sum_sq = 0.0;
    for c in &components {
        match c {
            Component::Atom { x, p } => {
                sum_sq += (x - mean).powi(2) * p;
            }
            Component::Bin { a, b, p } => {
                let center = (a + b) / 2.0;
                let width = b - a;
                // Variance = (diff from mean)^2 + internal variance
                let internal_var = width * width / 12.0;
                sum_sq += ((center - mean).powi(2) + internal_var) * p;
            }
            Component::Tail { x0, mass, lambda, is_right } => {
                let exp_mean = if *is_right { x0 + 1.0 / lambda } else { x0 - 1.0 / lambda };
                let exp_var = 1.0 / (lambda * lambda);
                sum_sq += ((exp_mean - mean).powi(2) + exp_var) * mass;
            }
        }
    }
    sum_sq / total_p
}

/// Calculate standard deviation
#[wasm_bindgen]
pub fn dist_std(components_data: Float64Array) -> f64 {
    dist_variance(components_data).sqrt()
}

/// Calculate P(X > x) - probability of exceeding x
#[wasm_bindgen]
pub fn dist_prob_gt(components_data: Float64Array, x: f64) -> f64 {
    let data: Vec<f64> = components_data.to_vec();
    let components = parse_components(&data);
    
    let total_p: f64 = components.iter().map(get_weight).sum();
    if total_p == 0.0 {
        return 0.0;
    }
    
    let mut prob = 0.0;
    for c in &components {
        match c {
            Component::Atom { x: ax, p } => {
                if *ax > x {
                    prob += p;
                }
            }
            Component::Bin { a, b, p } => {
                if *a > x {
                    prob += p;
                } else if *b > x {
                    // Partial overlap
                    let fraction = (b - x) / (b - a);
                    prob += p * fraction;
                }
            }
            Component::Tail { x0, mass, lambda, is_right } => {
                if *is_right {
                    // Right tail: P(X > x) where X ~ x0 + Exp(lambda)
                    if x < *x0 {
                        prob += mass;
                    } else {
                        prob += mass * (-(x - x0) * lambda).exp();
                    }
                } else {
                    // Left tail: P(X > x) where X ~ x0 - Exp(lambda)
                    if x >= *x0 {
                        // All mass is <= x0, so P(X > x) = 0
                    } else {
                        // P(x0 - Exp > x) = P(Exp < x0 - x) = 1 - exp(-lambda*(x0-x))
                        prob += mass * (1.0 - (-(x0 - x) * lambda).exp());
                    }
                }
            }
        }
    }
    prob / total_p
}

/// Mix two distributions: result = (1-p)*dist1 + p*dist2
#[wasm_bindgen]
pub fn dist_mix(
    dist1_data: Float64Array,
    dist2_data: Float64Array,
    p: f64,
) -> Float64Array {
    let data1: Vec<f64> = dist1_data.to_vec();
    let data2: Vec<f64> = dist2_data.to_vec();
    
    let comps1 = parse_components(&data1);
    let comps2 = parse_components(&data2);
    
    let mut result: Vec<Component> = Vec::new();
    
    // Scale first distribution by (1-p)
    for c in comps1 {
        let scaled = scale_component(&c, 1.0 - p);
        result.push(scaled);
    }
    
    // Scale second distribution by p
    for c in comps2 {
        let scaled = scale_component(&c, p);
        result.push(scaled);
    }
    
    let serialized = serialize_components(&result);
    Float64Array::from(serialized.as_slice())
}

/// Scale a component's probability
fn scale_component(c: &Component, factor: f64) -> Component {
    match c {
        Component::Atom { x, p } => Component::Atom { x: *x, p: p * factor },
        Component::Bin { a, b, p } => Component::Bin { a: *a, b: *b, p: p * factor },
        Component::Tail { x0, mass, lambda, is_right } => Component::Tail {
            x0: *x0,
            mass: mass * factor,
            lambda: *lambda,
            is_right: *is_right,
        },
    }
}

/// Scale distribution values by k
#[wasm_bindgen]
pub fn dist_scale(components_data: Float64Array, k: f64) -> Float64Array {
    let data: Vec<f64> = components_data.to_vec();
    let components = parse_components(&data);
    
    let mut result: Vec<Component> = Vec::new();
    
    for c in components {
        match c {
            Component::Atom { x, p } => {
                result.push(Component::Atom { x: x * k, p });
            }
            Component::Bin { a, b, p } => {
                if k >= 0.0 {
                    result.push(Component::Bin { a: a * k, b: b * k, p });
                } else {
                    result.push(Component::Bin { a: b * k, b: a * k, p });
                }
            }
            Component::Tail { x0, mass, lambda, is_right } => {
                if k >= 0.0 {
                    result.push(Component::Tail {
                        x0: x0 * k,
                        mass,
                        lambda: lambda / k.abs(),
                        is_right,
                    });
                } else {
                    result.push(Component::Tail {
                        x0: x0 * k,
                        mass,
                        lambda: lambda / k.abs(),
                        is_right: !is_right,
                    });
                }
            }
        }
    }
    
    let serialized = serialize_components(&result);
    Float64Array::from(serialized.as_slice())
}
