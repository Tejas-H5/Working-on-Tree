export type AsciiIconData = {
    data: string;
};


// https://www.asciiart.eu/nature/sun
export const ASCII_SUN: AsciiIconData = {
    data: (
                    `      ;   :   ;
   .   \\_,!,_/   ,
    \`.,':::::\`.,'
     /:::::::::\\
~ -- ::::::::::: -- ~
     \\:::::::::/
    ,'\`:::::::'\`.
   '   / \`!\` \\   \`
      ;   :   ;     `
    ),
}


// https://www.asciiart.eu/space/moons
// And then I added the stars, so those are kinda scuffed
export const ASCII_MOON_STARS: AsciiIconData = {
    data: (
                `
       _..._    *
  *  .::'   \`.    
    :::       :    |  
    :::       :   -+-
    \`::.     .'    |
 *    \`':..-'  .
               * .
      `
    )
}

// I did this one all myself, actually
export const ASCII_PLUS_ICON: AsciiIconData = {
    data: (
                `
                 
         ##        
         ##           
     ##########      
         ##          
         ##      
                  
      `
    )
};

// This one too. Pretty epic, I know
export const ASCII_MINUS_ICON: AsciiIconData = {
    data: (
                `
                 
                   
                      
     ##########      
                     
                 
                  
      `
    )
};
