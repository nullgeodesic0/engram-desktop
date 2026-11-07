import json, os, subprocess, random, datetime, sys
ENG = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "vendor", "engram", "scripts", "engram.py")
HOME = sys.argv[1]
os.makedirs(HOME, exist_ok=True)
env = dict(os.environ, ENGRAM_HOME=os.path.join(HOME, ".claude", "learning"))
def run(*a, today=None):
    e = dict(env)
    if today: e["ENGRAM_TODAY"] = today
    r = subprocess.run(["python3", ENG, *a], env=e, capture_output=True, text=True)
    if r.returncode: print("ERR", a[:3], r.stderr[:300])
    return r.stdout
random.seed(7)
TOPICS = {
 "quantum-harmonic-oscillator": ("Quantum Harmonic Oscillator", "Derive and use the ladder-operator solution of the QHO for a qualifying exam", [
   ("hamiltonian", "The QHO Hamiltonian is $H = \\frac{p^2}{2m} + \\frac{1}{2}m\\omega^2 x^2$.", "Write the Hamiltonian of a 1D harmonic oscillator and say why it is quadratic in both variables."),
   ("ladder-operators", "$a = \\sqrt{\\frac{m\\omega}{2\\hbar}}(x + \\frac{i}{m\\omega}p)$ lowers energy by $\\hbar\\omega$.", "Define the lowering operator and show what it does to an energy eigenstate."),
   ("commutator", "$[a, a^\\dagger] = 1$ follows from $[x,p]=i\\hbar$.", "Derive $[a,a^\\dagger]$ from the canonical commutator."),
   ("number-operator", "$H = \\hbar\\omega(a^\\dagger a + \\tfrac12)$.", "Rewrite H in terms of the number operator."),
   ("ground-state", "The ground state satisfies $a|0\\rangle = 0$, a Gaussian.", "Find the ground-state wavefunction from $a|0\\rangle=0$."),
   ("zero-point-energy", "$E_0 = \\tfrac12\\hbar\\omega$ is forced by the uncertainty principle.", "Why can't the oscillator have zero energy?"),
   ("energy-spectrum", "$E_n = \\hbar\\omega(n+\\tfrac12)$, evenly spaced.", "State the spectrum and explain the even spacing."),
   ("coherent-states", "Eigenstates of $a$ that move like a classical oscillator.", "What is a coherent state and why is it 'most classical'?"),
   ("matrix-elements", "$\\langle n-1|a|n\\rangle = \\sqrt{n}$.", "Compute $\\langle x^2 \\rangle$ in state $|n\\rangle$ with ladder operators."),
   ("selection-rules", "Dipole transitions only connect $n \\to n\\pm1$.", "Why does $x$ only connect adjacent levels?"),
 ]),
 "options-pricing": ("Options, Futures, Derivatives", "Price European options from no-arbitrage first principles", [
   ("forward-price", "$F = S_0 e^{rT}$ by cash-and-carry.", "Derive the forward price of a non-dividend stock."),
   ("put-call-parity", "$C - P = S_0 - Ke^{-rT}$.", "State put-call parity and the portfolio that proves it."),
   ("binomial-tree", "One-step replication gives risk-neutral probability $q$.", "Price a call on a one-step binomial tree."),
   ("risk-neutral", "Price is the discounted expectation under $\\mathbb{Q}$.", "Why does the real-world drift not appear in the price?"),
   ("gbm", "$dS = \\mu S dt + \\sigma S dW$.", "Write GBM and its solution."),
   ("ito-lemma", "Itô adds a $\\tfrac12 \\sigma^2 S^2 f''$ term.", "Apply Itô's lemma to $\\ln S$."),
   ("black-scholes-pde", "Delta hedging removes $dW$ and yields the BS PDE.", "Derive the Black–Scholes PDE by hedging."),
   ("greeks", "Delta, gamma, vega, theta measure sensitivities.", "What is gamma and why do short-gamma books fear jumps?"),
 ]),
 "bayesian-inference": ("Bayesian Inference", "Hold the core of Bayesian modelling well enough to read applied papers", [
   ("bayes-rule", "Posterior ∝ likelihood × prior.", "State Bayes' rule and name each term."),
   ("conjugacy", "Beta prior + binomial likelihood gives a Beta posterior.", "Update a Beta(2,2) prior after 7 heads in 10."),
   ("map-vs-mean", "MAP is the mode; posterior mean minimises squared loss.", "When do MAP and posterior mean differ?"),
   ("credible-interval", "A 95% credible interval holds 95% of posterior mass.", "Contrast a credible and a confidence interval."),
   ("hierarchical", "Partial pooling shrinks group estimates toward the grand mean.", "Why does a hierarchical model shrink small groups more?"),
   ("mcmc", "MCMC builds a chain whose stationary distribution is the posterior.", "Explain Metropolis acceptance in one sentence."),
 ]),
}
for tid, (title, goal, nodes) in TOPICS.items():
    g = {"topic": tid, "title": title, "goal": goal, "order": [n[0] for n in nodes], "nodes": {}}
    prev = None
    for i,(nid, claim, probe) in enumerate(nodes):
        g["nodes"][nid] = {"claim": claim, "probe": probe, "rubric": ["states the core relation", "justifies it"],
           "transfer_probe": None, "why_chain": [], "edges": {"requires": [prev] if prev else [], "derives_from": [], "contrasts_with": [], "analogous_to": []},
           "arbitrary": False, "threshold": i==3, "viz": None}
        prev = nid
    p = os.path.join(HOME, f"{tid}.json"); json.dump(g, open(p,"w"))
    print(run("add-topic", "--file", p, today="2026-09-20")[:200])

today = datetime.date(2026,11,7)
grades = ["recalled","recalled","recalled","partial","lapsed"]
rmap = {"recalled":"good","partial":"hard","lapsed":"again"}
# Learn first N nodes of each topic over past weeks, then reviews
learned = {"quantum-harmonic-oscillator":8, "options-pricing":6, "bayesian-inference":3}
day0 = datetime.date(2026,9,22)
for tid,(title,goal,nodes) in TOPICS.items():
    for i,(nid,_,_) in enumerate(nodes[:learned[tid]]):
        d = day0 + datetime.timedelta(days=i*3 + random.randint(0,2))
        run("rate","--topic",tid,"--node",nid,"--rating","good","--kind","encode","--grade","recalled","--confidence",str(random.randint(2,4)),"--production","x",today=d.isoformat())
        # reviews
        dd = d
        for k in range(random.randint(1,4)):
            dd = dd + datetime.timedelta(days=random.randint(3,12))
            if dd >= today: break
            gr = random.choice(grades)
            run("rate","--topic",tid,"--node",nid,"--rating",rmap[gr],"--grade",gr,"--confidence",str(random.randint(1,5)),"--production","my answer",today=dd.isoformat())
run("misconception","add","--topic","options-pricing","--node","risk-neutral","--description","Treats q as the real-world probability of an up move", today="2026-10-20")
print(run("topics"))
