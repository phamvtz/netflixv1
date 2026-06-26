'use strict';

// 50 nội dung mock cho trang browse — seed vào SQLite qua db/seed.js
const GRADIENTS = [
  'linear-gradient(135deg, #0f0c29 0%, #302b63 50%, #24243e 100%)',
  'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
  'linear-gradient(135deg, #200122 0%, #6f0000 100%)',
  'linear-gradient(135deg, #0d324d 0%, #7f5a83 100%)',
  'linear-gradient(135deg, #141e30 0%, #243b55 100%)',
  'linear-gradient(135deg, #232526 0%, #414345 100%)',
  'linear-gradient(135deg, #000428 0%, #004e92 100%)',
  'linear-gradient(135deg, #134e5e 0%, #71b280 100%)',
  'linear-gradient(135deg, #360033 0%, #0b8793 100%)',
  'linear-gradient(135deg, #1f4037 0%, #99f2c8 100%)',
];

const ACCENTS = ['#E50914', '#0071EB', '#F5A623', '#54B83F', '#9B59B6', '#00CED1', '#FF6B6B', '#BB86FC'];

const RAW = [
  { title: 'Stranger Things', type: 'series', seasons: 4, genres: ['Sci-Fi', 'Horror', 'Drama'], year: 2016, description: 'Nhóm bạn trẻ ở thị trấn Hawkins đối mặt với thế giới song song và những sinh vật kinh hoàng.', rows: ['continue_watching', 'trending', 'drama', 'scifi', 'horror'], featured: true, progress: 65 },
  { title: 'Squid Game', type: 'series', seasons: 1, genres: ['Thriller', 'Drama'], year: 2021, description: 'Hàng trăm người chơi tham gia trò chơi sinh tồn để giành giải thưởng khổng lồ.', rows: ['continue_watching', 'trending', 'drama', 'action'], progress: 40 },
  { title: 'Wednesday', type: 'series', seasons: 1, genres: ['Comedy', 'Horror', 'Mystery'], year: 2022, description: 'Wednesday Addams điều tra một loạt vụ án bí ẩn tại học viện Nevermore.', rows: ['continue_watching', 'trending', 'comedy', 'horror'], progress: 22 },
  { title: 'The Witcher', type: 'series', seasons: 3, genres: ['Fantasy', 'Action', 'Drama'], year: 2019, description: 'Geralt of Rivia — thợ săn quái vật — lạc lõng giữa thế giới nơi con người độc ác hơn quái thú.', rows: ['trending', 'action', 'drama'] },
  { title: 'Money Heist', type: 'series', seasons: 5, genres: ['Crime', 'Thriller', 'Drama'], year: 2017, description: 'Một thiên tài tội phạm lập kế hoạch cướp Dự trữ Ngân hàng Tây Ban Nha.', rows: ['trending', 'action', 'drama'] },
  { title: 'Bridgerton', type: 'series', seasons: 3, genres: ['Romance', 'Drama'], year: 2020, description: 'Gia đình Bridgerton và giới thượng lưu London thời Regency trong mùa giới thiệu.', rows: ['trending', 'romance', 'drama'] },
  { title: 'Dark', type: 'series', seasons: 3, genres: ['Sci-Fi', 'Mystery', 'Drama'], year: 2017, description: 'Bí mật gia đình và du hành thời gian ở thị trấn Winden, Đức.', rows: ['scifi', 'drama', 'horror'] },
  { title: 'Ozark', type: 'series', seasons: 4, genres: ['Crime', 'Drama', 'Thriller'], year: 2017, description: 'Gia đình Byrde rửa tiền cho cartel Mexico tại vùng Ozark.', rows: ['drama', 'action'] },
  { title: 'Narcos', type: 'series', seasons: 3, genres: ['Crime', 'Drama', 'Documentary'], year: 2015, description: 'Cuộc chiến chống ma túy và sự trỗi dậy của Pablo Escobar.', rows: ['action', 'drama', 'documentary'] },
  { title: 'The Crown', type: 'series', seasons: 6, genres: ['Drama', 'History'], year: 2016, description: 'Cuộc đời Nữ hoàng Elizabeth II và các sự kiện định hình thế kỷ 20.', rows: ['drama', 'documentary'] },
  { title: 'Black Mirror', type: 'series', seasons: 6, genres: ['Sci-Fi', 'Thriller', 'Drama'], year: 2011, description: 'Loạt phim antology về công nghệ và xã hội hiện đại.', rows: ['scifi', 'drama', 'new_releases'] },
  { title: 'Peaky Blinders', type: 'series', seasons: 6, genres: ['Crime', 'Drama'], year: 2013, description: 'Gia đình Shelby thống trị thế giới ngầm Birmingham sau Thế chiến I.', rows: ['drama', 'action'] },
  { title: 'The Queen\'s Gambit', type: 'series', seasons: 1, genres: ['Drama'], year: 2020, description: 'Cô gái mồ côi trở thành thiên tài cờ vua trong thế giới nam giới.', rows: ['drama', 'new_releases'] },
  { title: 'Lupin', type: 'series', seasons: 3, genres: ['Crime', 'Mystery', 'Action'], year: 2021, description: 'Assane Diop lấy cảm hứng từ Arsène Lupin để trả thù cho cha mình.', rows: ['action', 'new_releases', 'trending'] },
  { title: 'You', type: 'series', seasons: 4, genres: ['Thriller', 'Drama', 'Romance'], year: 2018, description: 'Joe Goldberg — kẻ ám ảnh tình yêu nguy hiểm — chuyển từ New York sang London.', rows: ['drama', 'romance', 'horror'] },
  { title: 'Elite', type: 'series', seasons: 7, genres: ['Drama', 'Mystery', 'Romance'], year: 2018, description: 'Ba học sinh trung học nghèo học chung trường danh giá Las Encinas.', rows: ['drama', 'romance'] },
  { title: 'Cobra Kai', type: 'series', seasons: 6, genres: ['Action', 'Comedy', 'Drama'], year: 2018, description: 'Johnny Lawrence mở lại dojo Cobra Kai, tái đối đầu Daniel LaRusso.', rows: ['action', 'comedy'] },
  { title: 'The Umbrella Academy', type: 'series', seasons: 4, genres: ['Sci-Fi', 'Action', 'Comedy'], year: 2019, description: 'Nhóm anh chị em siêu anh hùng cứu thế giới khỏi apocalypse.', rows: ['scifi', 'action', 'comedy'] },
  { title: 'Sex Education', type: 'series', seasons: 4, genres: ['Comedy', 'Drama', 'Romance'], year: 2019, description: 'Otis mở phòng tư vấn tình dục bí mật tại trường Moordale.', rows: ['comedy', 'romance', 'drama'] },
  { title: 'Manifest', type: 'series', seasons: 4, genres: ['Mystery', 'Drama', 'Sci-Fi'], year: 2018, description: 'Hành khách chuyến bay biến mất 5 năm rồi trở lại không già đi.', rows: ['scifi', 'drama'] },
  { title: 'Outer Banks', type: 'series', seasons: 4, genres: ['Adventure', 'Drama', 'Mystery'], year: 2020, description: 'Nhóm bạn Pogues tìm kho báu và giải mã bí mật Outer Banks.', rows: ['action', 'drama', 'new_releases'] },
  { title: 'All of Us Are Dead', type: 'series', seasons: 1, genres: ['Horror', 'Drama', 'Action'], year: 2022, description: 'Zombie xâm lấn trường trung học Hyun-san — học sinh phải sinh tồn.', rows: ['horror', 'action', 'new_releases'] },
  { title: 'Alice in Borderland', type: 'series', seasons: 2, genres: ['Thriller', 'Sci-Fi', 'Action'], year: 2020, description: 'Arisu bị kéo vào Tokyo song song, buộc chơi trò chơi sinh tử.', rows: ['action', 'scifi', 'trending'] },
  { title: 'The Sandman', type: 'series', seasons: 1, genres: ['Fantasy', 'Drama', 'Horror'], year: 2022, description: 'Dream — vị vua của cõi mơ — bị giam cầm rồi trở về để sửa chữa vũ trụ.', rows: ['drama', 'horror', 'scifi'] },
  { title: 'Arcane', type: 'series', seasons: 2, genres: ['Animation', 'Action', 'Drama'], year: 2021, description: 'Chị em Vi và Jinx ở hai thành phố đối địch trong vũ trụ League of Legends.', rows: ['animation', 'action', 'trending'] },
  { title: 'Blue Eye Samurai', type: 'series', seasons: 1, genres: ['Animation', 'Action', 'Drama'], year: 2023, description: 'Kiếm sĩ bán Nhật bán châu Âu tìm cách trả thù 4 người ngoại quốc.', rows: ['animation', 'action', 'new_releases'] },
  { title: 'Klaus', type: 'movie', duration: '1h 36m', genres: ['Animation', 'Family', 'Comedy'], year: 2019, description: 'Bưu tá Jesper và thợ đồ chơi Klaus mang phép màu Giáng sinh đến thị trấn.', rows: ['animation', 'comedy', 'new_releases'] },
  { title: 'Extraction', type: 'movie', duration: '1h 57m', genres: ['Action', 'Thriller'], year: 2020, description: 'Tyler Rake — lính đánh thuê — thực hiện nhiệm vụ giải cứu con trai tỷ phú.', rows: ['action', 'trending'] },
  { title: 'The Irishman', type: 'movie', duration: '3h 29m', genres: ['Crime', 'Drama'], year: 2019, description: 'Frank Sheeran kể về cuộc đời trong giới mafia và mối quan hệ với Jimmy Hoffa.', rows: ['drama', 'documentary'] },
  { title: 'Bird Box', type: 'movie', duration: '2h 4m', genres: ['Horror', 'Thriller', 'Sci-Fi'], year: 2018, description: 'Malorie và hai đứa trẻ phải đi xuyên sông mù mịt tránh sinh vật gây tự sát.', rows: ['horror', 'scifi'] },
  { title: 'Red Notice', type: 'movie', duration: '1h 58m', genres: ['Action', 'Comedy'], year: 2021, description: 'FBI, art thief và đối thủ cạnh tranh trong cuộc truy đuổi khắp thế giới.', rows: ['action', 'comedy', 'trending'] },
  { title: 'Don\'t Look Up', type: 'movie', duration: '2h 18m', genres: ['Comedy', 'Drama', 'Sci-Fi'], year: 2021, description: 'Hai nhà thiên văn cảnh báo thiên thạch hủy diệt nhưng không ai tin.', rows: ['comedy', 'drama', 'scifi'] },
  { title: 'The Gray Man', type: 'movie', duration: '2h 9m', genres: ['Action', 'Thriller'], year: 2022, description: 'Agent CIA Court Gentry — The Gray Man — bị truy sát bởi cựu đồng nghiệp.', rows: ['action', 'new_releases'] },
  { title: 'Glass Onion', type: 'movie', duration: '2h 19m', genres: ['Mystery', 'Comedy', 'Crime'], year: 2022, description: 'Benoit Blanc điều tra vụ án trên đảo riêng của tỷ phú công nghệ.', rows: ['comedy', 'new_releases'] },
  { title: 'The Adam Project', type: 'movie', duration: '1h 46m', genres: ['Sci-Fi', 'Action', 'Comedy'], year: 2022, description: 'Phi công du hành thời gian gặp bản thân 12 tuổi để cứu tương lai.', rows: ['scifi', 'comedy', 'action'] },
  { title: 'Enola Holmes', type: 'movie', duration: '2h 3m', genres: ['Mystery', 'Adventure', 'Comedy'], year: 2020, description: 'Em gái Sherlock tìm mẹ mất tích trong cuộc phiêu lưu Victorian.', rows: ['comedy', 'action', 'new_releases'] },
  { title: 'Our Planet', type: 'series', seasons: 1, genres: ['Documentary', 'Nature'], year: 2019, description: 'Loạt phim tài liệu về thiên nhiên và đa dạng sinh học trên Trái Đất.', rows: ['documentary', 'new_releases'] },
  { title: 'The Night Agent', type: 'series', seasons: 2, genres: ['Thriller', 'Action', 'Drama'], year: 2023, description: 'A low-level FBI agent answering an emergency line is pulled into a deadly conspiracy reaching the White House.', rows: ['trending', 'action', 'drama'] },
  { title: 'Beef', type: 'series', seasons: 1, genres: ['Comedy', 'Drama'], year: 2023, description: 'A road-rage incident between two strangers spirals into a feud that consumes their lives.', rows: ['trending', 'comedy', 'drama', 'new_releases'] },
  { title: 'One Piece', type: 'series', seasons: 1, genres: ['Adventure', 'Action', 'Fantasy'], year: 2023, description: 'Monkey D. Luffy and his crew sail the seas in search of the legendary treasure known as the One Piece.', rows: ['trending', 'action', 'new_releases'] },
  { title: 'Fool Me Once', type: 'series', seasons: 1, genres: ['Thriller', 'Mystery', 'Drama'], year: 2024, description: 'A grieving widow spots her murdered husband on a nanny cam and uncovers a web of family secrets.', rows: ['trending', 'drama', 'new_releases'] },
  { title: '3 Body Problem', type: 'series', seasons: 1, genres: ['Sci-Fi', 'Mystery', 'Drama'], year: 2024, description: 'A scientist\'s fateful decision in 1960s China echoes across space and time to a group of present-day researchers.', rows: ['scifi', 'drama', 'trending', 'new_releases'] },
  { title: 'Avatar: The Last Airbender', type: 'series', seasons: 1, genres: ['Adventure', 'Action', 'Fantasy'], year: 2024, description: 'A young Air Nomad must master the four elements to bring balance to a world threatened by the Fire Nation.', rows: ['action', 'new_releases', 'trending'] },
  { title: 'Baby Reindeer', type: 'series', seasons: 1, genres: ['Drama', 'Thriller'], year: 2024, description: 'A struggling comedian\'s small act of kindness triggers an obsessive stalking that unravels his past.', rows: ['drama', 'new_releases'] },
  { title: 'The Diplomat', type: 'series', seasons: 2, genres: ['Drama', 'Thriller'], year: 2023, description: 'A career diplomat lands a high-profile ambassadorship while navigating an international crisis and her own marriage.', rows: ['drama', 'trending'] },
  { title: 'Heartstopper', type: 'series', seasons: 3, genres: ['Romance', 'Drama', 'Comedy'], year: 2022, description: 'Two teenage boys at a British grammar school discover friendship can blossom into something more.', rows: ['romance', 'comedy', 'drama'] },
  { title: 'Leave the World Behind', type: 'movie', duration: '2h 18m', genres: ['Thriller', 'Drama', 'Sci-Fi'], year: 2023, description: 'A family vacation is upended when two strangers arrive at night amid a mysterious nationwide blackout.', rows: ['scifi', 'drama', 'new_releases'] },
  { title: 'Society of the Snow', type: 'movie', duration: '2h 24m', genres: ['Drama', 'Adventure'], year: 2023, description: 'Survivors of a 1972 Andes plane crash fight to stay alive against impossible odds.', rows: ['drama', 'new_releases'] },
  { title: 'Damsel', type: 'movie', duration: '1h 50m', genres: ['Fantasy', 'Action', 'Adventure'], year: 2024, description: 'A young woman agrees to marry a prince, only to be sacrificed to a fire-breathing dragon she must outwit.', rows: ['action', 'new_releases', 'trending'] },
  { title: 'Maestro', type: 'movie', duration: '2h 9m', genres: ['Drama', 'Music'], year: 2023, description: 'The decades-spanning love story between conductor Leonard Bernstein and Felicia Montealegre.', rows: ['drama', 'new_releases'] },
];

const content = RAW.map((item, index) => ({
  id: index + 1,
  rating: item.type === 'movie' ? 'PG-13' : 'TV-14',
  maturity: item.type === 'movie' ? '13+' : '16+',
  gradient: GRADIENTS[index % GRADIENTS.length],
  accent: ACCENTS[index % ACCENTS.length],
  ...item,
}));

if (content.length !== 50) {
  throw new Error(`data/content.js: expected 50 items, got ${content.length}`);
}

module.exports = { content };
