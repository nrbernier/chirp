## Idea

I want to create a game where one navigates purely with sound.

The basic idea of the game is that there's a 2D sound image. Horizontal is
left-right stereo image and vertical is the pitch. In the basic stage of the
game, one has a goal sound (certain left-right spatialisation and pitch) and one
must navigate with one's own sound until they match (using arrow keys). The two
sounds should be some kind of synthesized chirp noises, with different textures
so that they can be differentiated.

At later stages, instead of a single target sound, there can be multiple. The
goal is to land in the middle position between two, three four sounds. Ideally
the different sounds should have some harmonic relations so that the results is
pleasing to the ear.

For initial tutorial stage, there can be a visual representation. First a
representation of the 2D position of both the target and player sounds, then
they disappear. Maybe a helper function to make them visible on demand even in
later stages to help if one is lost.

For increased difficulty at later stages, there can be some additional noises
that give some sort of overlay to blur a little be the picture. It should
ideally be pleasing, like some synthesized music.

Also in later stages, maybe the target can be dynamic. It moves and one must
follow it as it does so.
