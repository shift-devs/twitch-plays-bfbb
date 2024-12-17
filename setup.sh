#!/bin/sh
# root
# annoying annoying annoying virtualbox masssagess
# remember to change dolphin sneak shift to 40%
# remember to copy game settings ini to ~/.local/share/dolphin-emu/GameSettings because cheat codes
# remember disable dolphin message
# remember auto login
# remember auto startx
# remember ~/.config/autostart .desktop or fork
# remember tailscale
# remember x11vnc fork
# remember test multi core perf + disable efb access from cpu
# disable status + menu bars
# --- bind sneak to ctrl instead?
# UPDATE THE TIMES they kinda suck (normal move / look goes too little, whilst giga too much, keep giga same maybe, but increase normals)
# allow people to choose between giga/light/micro and manually specifying seconds
# remind shift he can do (right ctrl + a)
# start instead of tp start (and maybe pause as alt to start?)
# add halt command to stop current inputs
# if right is done while moving left, stop moving left, vice versa, same for up and down
# prioritize most recent inputs
# micro up / down - there should be no need to specify move
# if an input gets set to 10, tick will immediately set it to 0 without giving it the chance to run # is there a better way to handle non control stick inputs than ticking system?
# why does audio keep muting / breaking? >:( (use pulseaudio not straight alsa - set it in dolphin)
# remove cd drive from vm
# remember to use gecko code
# dont do panic messages
# maybe reduce clock speed to reduce audio stuttering
# fix savestate hotkeys
# make sure dolphin doesnt pop up on end game
# lock dolphin cpu to 40%?

tp(){
echo twitchplays | tee /etc/hostname
usermod -l chat arch
usermod -d /home/chat -m chat
groupmod -n chat arch
cd /etc/sudoers.d
rm arch
echo chat ALL=\(ALL\) NOPASSWD: ALL > chat
echo chat:chat | sudo chpasswd
ln -sf /usr/share/zoneinfo/US/Eastern /etc/localtime
hwclock --systohc
pacman -Syu
pacman -S --noconfirm xorg xorg-xinit x11vnc lxde dolphin-emu nodejs npm pulseaudio-jack pavucontrol
setcap cap_sys_ptrace=eip /usr/bin/node
gettysrv=/etc/systemd/system/getty@tty1.service.d
mkdir -p $gettysrv
cd $gettysrv
echo [Service] > autologin.conf
echo ExecStart= >> autologin.conf
echo ExecStart=-/sbin/agetty -o \'-p -f -- \\\\u\' --noclear --autologin chat %I \$TERM >> autologin.conf
systemctl enable getty@tty1.service
cd /home/chat
echo if [ -z \"\$DISPLAY\" ] \&\& [ \"\$XDG_VTNR\" = 1 ]\; then > .bash_profile
echo startx >> .bash_profile
echo fi >> .bash_profile
echo x11vnc -many -display :0 -no6 -rfbport 5900 \& > .xinitrc
echo exec startlxde >> .xinitrc
chown -R chat:chat .
reboot
}
tp