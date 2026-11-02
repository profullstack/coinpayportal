/**
 * Word lists for memorable sign-in passphrases.
 *
 * A generated phrase is a silly sentence, not a list of random words:
 *
 *   fuzzy purple walrus juggles a rusty trumpet under the sleepy volcano loudly
 *
 * People remember a picture far better than 12 unrelated words, and every slot
 * still comes from a crypto-random pick. Each list is an exact power of two so
 * a pick is a bit mask with no modulo bias, and the entropy is exact:
 *
 *   adj 8 + color 4 + noun 8 + verb 8 + adj 8 + noun 8 + prep 5 + adj 8 + noun 8 + adverb 6 = 71 bits
 *
 * Words are short, concrete, everyday English, lowercase a-z only, no word
 * appears in two lists, and nothing is rude. words.test.ts enforces all of it.
 * NEVER reorder or edit these lists: they do not affect existing logins (the
 * phrase itself is what gets hashed), but tests pin the sizes and the
 * entropy figure shown to users.
 */

export const ADJECTIVES = [
  'angry', 'bald', 'bashful', 'bendy', 'big', 'bitter', 'bold', 'bony',
  'bouncy', 'brave', 'breezy', 'bright', 'brisk', 'bubbly', 'bumpy', 'busy',
  'calm', 'chatty', 'cheeky', 'cheerful', 'chilly', 'chubby', 'chunky', 'clever',
  'clumsy', 'cosy', 'crafty', 'cranky', 'crispy', 'crooked', 'crunchy', 'cuddly',
  'curious', 'curly', 'dainty', 'damp', 'dapper', 'daring', 'dizzy', 'dopey',
  'dreamy', 'dusty', 'eager', 'early', 'elegant', 'fancy', 'fearless', 'feisty',
  'fiery', 'fluffy', 'foggy', 'fragile', 'frantic', 'friendly', 'frosty', 'frozen',
  'fuzzy', 'gentle', 'giant', 'giddy', 'gigantic', 'glassy', 'gloomy', 'glossy',
  'goofy', 'graceful', 'grassy', 'greasy', 'grumpy', 'hairy', 'happy', 'hasty',
  'heavy', 'helpful', 'hollow', 'honest', 'hopeful', 'huge', 'humble', 'hungry',
  'icy', 'jolly', 'jumpy', 'kind', 'knobbly', 'lanky', 'lazy', 'leafy',
  'little', 'lively', 'lonely', 'loud', 'lucky', 'lumpy', 'magic', 'massive',
  'mellow', 'messy', 'mighty', 'misty', 'modest', 'moody', 'muddy', 'mushy',
  'nervous', 'nimble', 'noble', 'noisy', 'nosy', 'nutty', 'odd', 'oily',
  'olden', 'orderly', 'patient', 'peaceful', 'perky', 'plump', 'polite', 'portly',
  'proud', 'puffy', 'quick', 'quiet', 'quirky', 'rapid', 'rickety', 'roaring',
  'rocky', 'rosy', 'rough', 'round', 'rowdy', 'royal', 'rubbery', 'rusty',
  'sandy', 'sassy', 'scaly', 'scruffy', 'secret', 'shaggy', 'shiny', 'shy',
  'silent', 'silky', 'silly', 'sleepy', 'slimy', 'slow', 'sly', 'small',
  'smelly', 'smiley', 'smoky', 'smooth', 'sneaky', 'snowy', 'soft', 'soggy',
  'solid', 'sour', 'sparkly', 'speedy', 'spicy', 'spiky', 'spooky', 'sporty',
  'spotty', 'springy', 'squeaky', 'squishy', 'stately', 'steady', 'steamy', 'sticky',
  'stormy', 'stout', 'strange', 'stripy', 'strong', 'stubborn', 'sturdy', 'sunny',
  'super', 'swift', 'tall', 'tame', 'tangy', 'tidy', 'timid', 'tiny',
  'tired', 'toasty', 'tough', 'tricky', 'trusty', 'tubby', 'twisty', 'ugly',
  'upbeat', 'velvet', 'vivid', 'wacky', 'warm', 'wavy', 'waxy', 'weary',
  'wild', 'windy', 'wise', 'witty', 'wobbly', 'wonky', 'woolly', 'worried',
  'yummy', 'zany', 'zesty', 'zippy', 'ancient', 'awkward', 'bossy', 'brainy',
  'burly', 'chilled', 'comfy', 'cool', 'crusty', 'dashing', 'dotty', 'drowsy',
  'faithful', 'famous', 'fizzy', 'floppy', 'frilly', 'furry', 'gleaming', 'glowing',
  'gooey', 'grand', 'greedy', 'hefty', 'jazzy', 'jiggly', 'juicy', 'lofty',
  'loyal', 'merry', 'minty', 'peppy', 'prickly', 'puny', 'rugged', 'salty',
] as const;

export const COLORS = [
  'amber', 'black', 'blue', 'bronze', 'brown', 'coral', 'golden', 'green',
  'grey', 'orange', 'pink', 'purple', 'red', 'silver', 'white', 'yellow',
] as const;

export const NOUNS = [
  'accordion', 'acorn', 'alligator', 'anchor', 'anteater', 'apple', 'apron', 'armadillo',
  'avocado', 'badger', 'bagel', 'balloon', 'banana', 'banjo', 'barrel', 'basket',
  'beaver', 'bicycle', 'biscuit', 'blanket', 'blender', 'bucket', 'buffalo', 'bulldozer',
  'burrito', 'butler', 'button', 'cabbage', 'cactus', 'camel', 'canoe', 'captain',
  'carrot', 'castle', 'caterpillar', 'cauldron', 'cello', 'chicken', 'chimney', 'cobbler',
  'coconut', 'cookie', 'cowboy', 'crab', 'crayon', 'cricket', 'crocodile', 'crumpet',
  'cupcake', 'cushion', 'dentist', 'dinosaur', 'dolphin', 'donkey', 'doughnut', 'dragon',
  'drummer', 'duck', 'dumpling', 'eagle', 'eggplant', 'elephant', 'elf', 'falcon',
  'farmer', 'ferret', 'fiddle', 'firefly', 'flamingo', 'flute', 'fox', 'frog',
  'gargoyle', 'gecko', 'ghost', 'giraffe', 'goat', 'goblin', 'goose', 'gorilla',
  'grandma', 'grandpa', 'guitar', 'hammock', 'hamster', 'harp', 'hedgehog', 'helmet',
  'hippo', 'honey', 'horse', 'iguana', 'jellyfish', 'jester', 'kangaroo', 'kettle',
  'kitten', 'koala', 'ladder', 'lantern', 'lemon', 'lemur', 'librarian', 'lighthouse',
  'llama', 'lobster', 'lollipop', 'magician', 'mango', 'mermaid', 'meatball', 'mitten',
  'mole', 'monkey', 'moose', 'mushroom', 'muffin', 'noodle', 'octopus', 'ogre',
  'onion', 'orchestra', 'ostrich', 'otter', 'owl', 'pancake', 'panda', 'parrot',
  'peacock', 'peanut', 'pebble', 'pelican', 'penguin', 'pickle', 'pigeon', 'pillow',
  'pineapple', 'pirate', 'pizza', 'platypus', 'plumber', 'poodle', 'popcorn', 'porcupine',
  'potato', 'pretzel', 'pudding', 'pumpkin', 'puppet', 'puppy', 'rabbit', 'raccoon',
  'radish', 'raven', 'robot', 'rocket', 'rooster', 'sailor', 'salmon', 'sandwich',
  'sausage', 'saxophone', 'scarecrow', 'scooter', 'seagull', 'seal', 'shark', 'sheep',
  'sheriff', 'skeleton', 'skunk', 'sloth', 'snail', 'snowman', 'sock', 'spider',
  'spoon', 'squid', 'squirrel', 'starfish', 'submarine', 'suitcase', 'swan', 'taco',
  'teacup', 'teapot', 'tiger', 'toaster', 'tomato', 'tortoise', 'tractor', 'trombone',
  'trumpet', 'tuba', 'turkey', 'turnip', 'turtle', 'umbrella', 'unicorn', 'vampire',
  'violin', 'vulture', 'waffle', 'walrus', 'wizard', 'wombat', 'yak', 'zebra',
  'astronaut', 'baker', 'bandit', 'bishop', 'brownie', 'buzzard', 'cheetah', 'chipmunk',
  'clown', 'cobra', 'cyclops', 'detective', 'dodo', 'emu', 'gnome', 'gopher',
  'heron', 'hyena', 'jaguar', 'knight', 'ladybug', 'leopard', 'lizard', 'mammoth',
  'marmot', 'moth', 'mouse', 'narwhal', 'newt', 'ninja', 'panther', 'parsnip',
  'pony', 'possum', 'puffin', 'python', 'reindeer', 'rhino', 'robin', 'salamander',
  'sardine', 'scorpion', 'toad', 'toucan', 'troll', 'viking', 'weasel', 'yeti',
] as const;

/** Third person singular, takes an object: "the walrus ___ a trumpet". */
export const VERBS = [
  'admires', 'bakes', 'balances', 'bangs', 'bathes', 'battles', 'befriends', 'bends',
  'bites', 'blesses', 'boils', 'bounces', 'bribes', 'brushes', 'builds', 'buries',
  'buys', 'calls', 'carries', 'carves', 'catches', 'chases', 'chews', 'chops',
  'cleans', 'climbs', 'collects', 'combs', 'cooks', 'copies', 'counts', 'cradles',
  'crushes', 'cuddles', 'dances', 'decorates', 'delivers', 'describes', 'designs', 'dips',
  'drags', 'draws', 'dresses', 'drops', 'dunks', 'dusts', 'eats', 'escorts',
  'feeds', 'fetches', 'fixes', 'flips', 'folds', 'follows', 'fries', 'frightens',
  'gathers', 'gifts', 'glues', 'grabs', 'greets', 'grills', 'guards', 'hammers',
  'hides', 'hires', 'holds', 'hugs', 'hunts', 'interviews', 'irons', 'jiggles',
  'juggles', 'kicks', 'kisses', 'knits', 'launches', 'licks', 'lifts', 'loves',
  'mails', 'marries', 'measures', 'melts', 'mends', 'milks', 'mixes', 'mocks',
  'nibbles', 'nudges', 'oils', 'opens', 'orders', 'packs', 'paints', 'pats',
  'peels', 'pets', 'photographs', 'pickles', 'pinches', 'plants', 'pokes', 'polishes',
  'pours', 'praises', 'presses', 'pulls', 'punts', 'pushes', 'rescues', 'rides',
  'rinses', 'roasts', 'robs', 'rocks', 'rolls', 'rubs', 'salutes', 'saves',
  'scares', 'scrubs', 'seasons', 'sells', 'serenades', 'shakes', 'shaves', 'shears',
  'shoves', 'sketches', 'slices', 'smells', 'smuggles', 'sniffs', 'soaks', 'spritzes',
  'spins', 'splashes', 'squashes', 'squeezes', 'stacks', 'steals', 'stirs', 'strokes',
  'stuffs', 'swallows', 'swings', 'tackles', 'tames', 'teaches', 'teases', 'tickles',
  'tosses', 'tows', 'trades', 'trains', 'traps', 'tugs', 'tunes', 'twirls',
  'unwraps', 'visits', 'wakes', 'warms', 'washes', 'waves', 'weighs', 'whacks',
  'whips', 'wiggles', 'winds', 'wraps', 'wrestles', 'xeroxes', 'yanks', 'zaps',
  'ambushes', 'applauds', 'bandages', 'barbecues', 'blasts', 'blends', 'boots', 'borrows',
  'braids', 'brews', 'bumps', 'buttons', 'captures', 'chains', 'charms', 'chills',
  'clips', 'coaches', 'crowns', 'curls', 'dangles', 'dazzles', 'drills', 'dries',
  'fans', 'films', 'flattens', 'flings', 'fluffs', 'freezes', 'frosts', 'glazes',
  'grates', 'heats', 'hooks', 'hurls', 'inflates', 'invites', 'jabs', 'knights',
  'lassos', 'lathers', 'leashes', 'loads', 'mashes', 'nabs', 'naps', 'paddles',
  'patches', 'pedals', 'plucks', 'pumps', 'quizzes', 'rakes', 'raffles', 'repairs',
  'ropes', 'sands', 'scoops', 'sews', 'shines', 'shrinks', 'sizzles', 'slurps',
  'smashes', 'snags', 'spoons', 'sprinkles', 'squirts', 'stamps', 'steers', 'sweeps',
  'tapes', 'toasts', 'topples', 'trims', 'unlocks', 'wheels', 'whistles', 'zips',
] as const;

export const PREPOSITIONS = [
  'above', 'across', 'after', 'against', 'along', 'amid', 'around', 'atop',
  'before', 'behind', 'below', 'beneath', 'beside', 'beyond', 'by', 'during',
  'inside', 'near', 'onto', 'outside', 'over', 'past', 'through', 'toward',
  'under', 'underneath', 'upon', 'with', 'within', 'without', 'into', 'from',
] as const;

export const ADVERBS = [
  'angrily', 'badly', 'barely', 'blindly', 'boldly', 'bravely', 'briskly', 'busily',
  'calmly', 'carefully', 'cheerfully', 'clumsily', 'crazily', 'daily', 'eagerly', 'easily',
  'fiercely', 'firmly', 'gently', 'gladly', 'gleefully', 'gracefully', 'greedily', 'happily',
  'hastily', 'honestly', 'hungrily', 'joyfully', 'kindly', 'lazily', 'loudly', 'madly',
  'merrily', 'neatly', 'nervously', 'noisily', 'nightly', 'oddly', 'patiently', 'politely',
  'proudly', 'quickly', 'quietly', 'rapidly', 'rarely', 'rudely', 'sadly', 'secretly',
  'shyly', 'silently', 'sleepily', 'slowly', 'smoothly', 'softly', 'sternly', 'swiftly',
  'tenderly', 'tightly', 'twice', 'warmly', 'weekly', 'wildly', 'wisely', 'yearly',
] as const;
